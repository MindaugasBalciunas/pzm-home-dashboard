using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using PzmHomeDashboard.Models;

namespace PzmHomeDashboard.Services;

public sealed class StreamManager : BackgroundService, IAsyncDisposable
{
    private readonly DashboardOptions _options;
    private readonly CameraRegistry _registry;
    private readonly ILogger<StreamManager> _log;
    private readonly string _hlsRoot;
    private readonly Dictionary<string, StreamSession> _sessions = new(StringComparer.OrdinalIgnoreCase);
    // Cameras whose low-latency transcode failed to deliver a playlist —
    // they run as plain stream copy until the add-on restarts, instead of
    // black-screening (weak CPU, odd codec, missing filter, …).
    private readonly HashSet<string> _copyFallback = new(StringComparer.OrdinalIgnoreCase);
    // Per-camera cooldown: after a start fails to produce a playlist, refuse
    // to respawn ffmpeg for this window. A tile pointed at an unreachable
    // camera otherwise retries the playlist every few seconds and each miss
    // spawns a fresh ffmpeg that dies immediately — a spin loop that pegs a
    // weak ARM box. The cooldown clears the moment a start succeeds again.
    private readonly Dictionary<string, DateTime> _cooldownUntil = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan FailureCooldown = TimeSpan.FromSeconds(30);
    private readonly object _gate = new();

    public StreamManager(
        DashboardOptions options,
        CameraRegistry registry,
        ILogger<StreamManager> log)
    {
        _options = options;
        _registry = registry;
        _log = log;
        _hlsRoot = Environment.GetEnvironmentVariable("HLS_ROOT") ?? "/tmp/rtspviewer";
        Directory.CreateDirectory(_hlsRoot);
        PurgeHlsRoot();
    }

    // Wipe leftover per-camera segment dirs at startup. A hard kill (SIGKILL,
    // container restart) or a renamed camera leaves orphaned directories that
    // nothing reclaims — on boxes where the HLS root is tmpfs they sit in RAM.
    private void PurgeHlsRoot()
    {
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(_hlsRoot))
            {
                try { Directory.Delete(dir, recursive: true); } catch { /* best effort */ }
            }
            foreach (var f in Directory.EnumerateFiles(_hlsRoot))
            {
                try { File.Delete(f); } catch { /* best effort */ }
            }
        }
        catch { /* best effort */ }
    }

    public string GetOutputDir(string cameraId) => Path.Combine(_hlsRoot, cameraId);

    public void Touch(string cameraId)
    {
        lock (_gate)
        {
            if (_sessions.TryGetValue(cameraId, out var s))
            {
                s.LastAccessUtc = DateTime.UtcNow;
            }
        }
    }

    public async Task<string?> EnsurePlaylistAsync(string cameraId, CancellationToken ct)
    {
        if (!_registry.TryGet(cameraId, out var camera))
        {
            return null;
        }

        for (var attempt = 0; ; attempt++)
        {
            StreamSession session;
            lock (_gate)
            {
                if (!_sessions.TryGetValue(cameraId, out session!))
                {
                    // Recently failed: don't respawn ffmpeg until the cooldown
                    // elapses (a 404 here just tells the player to keep waiting).
                    if (_cooldownUntil.TryGetValue(cameraId, out var until) && DateTime.UtcNow < until)
                    {
                        return null;
                    }
                    var transcode = _options.LowLatencyTranscode && !_copyFallback.Contains(cameraId);
                    session = StartFfmpeg(cameraId, camera, transcode);
                    _sessions[cameraId] = session;
                }
                session.LastAccessUtc = DateTime.UtcNow;
            }

            var playlist = Path.Combine(GetOutputDir(cameraId), "index.m3u8");
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (DateTime.UtcNow < deadline)
            {
                if (File.Exists(playlist))
                {
                    lock (_gate) _cooldownUntil.Remove(cameraId);
                    return playlist;
                }
                if (session.Process.HasExited)
                {
                    break;
                }
                try { await Task.Delay(200, ct); }
                catch (OperationCanceledException) { return null; }
            }

            var reason = session.Process.HasExited
                ? $"ffmpeg exited with code {session.Process.ExitCode} before producing a playlist"
                : "timed out waiting for the HLS playlist";

            // Only the caller that owns this session in the dictionary tears
            // it down; concurrent viewers of the same failed camera must not
            // double-Kill the process or race to spawn a replacement.
            bool owns;
            lock (_gate)
            {
                owns = _sessions.TryGetValue(cameraId, out var current) && ReferenceEquals(current, session);
                if (owns) _sessions.Remove(cameraId);
            }
            if (!owns) return null;

            await StopSessionAsync(session, reason: "no playlist");

            if (session.Transcoded && attempt == 0)
            {
                _log.LogWarning(
                    "Camera {Id}: {Reason}; falling back to stream copy (no transcode) for this camera.",
                    cameraId, reason);
                lock (_gate) _copyFallback.Add(cameraId);
                continue;
            }

            _log.LogWarning("Camera {Id}: {Reason}. Cooling down for {Seconds}s.",
                cameraId, reason, (int)FailureCooldown.TotalSeconds);
            lock (_gate) _cooldownUntil[cameraId] = DateTime.UtcNow + FailureCooldown;
            return null;
        }
    }

    private StreamSession StartFfmpeg(string cameraId, CameraOptions camera, bool transcode)
    {
        var outDir = GetOutputDir(cameraId);
        Directory.CreateDirectory(outDir);
        CleanDirectory(outDir);

        var input = BuildRtspUrl(camera);
        var transport = string.IsNullOrWhiteSpace(camera.Transport) ? "tcp" : camera.Transport;
        // Low-latency mode pins segments at 1s — the whole point of the
        // re-encode is a keyframe cadence shorter than the camera's GOP,
        // and stored add-on options may still carry the old 2s default.
        var segTime = transcode ? 1 : Math.Max(1, _options.HlsSegmentSeconds);
        var listSize = Math.Max(2, _options.HlsListSize);

        var args = new StringBuilder();
        // `error`, not `warning`: at warning level libx264 emits a "VBV
        // underflow" line PER FRAME (a benign rate-control artifact of the
        // forced 1s keyframes) — 8 cameras × frame rate flooded the add-on
        // log, and every line synchronously hit the console logger on a
        // thread-pool thread, back-pressuring and stalling the web server.
        // Genuine ffmpeg errors still surface; failure detection is
        // playlist-based, not stderr-based, so nothing else is affected.
        args.Append("-nostdin -hide_banner -loglevel error ");
        args.Append("-fflags nobuffer -flags low_delay ");
        // Defaults are 5s / 5MB of probing before the first frame; RTSP's
        // SDP already carries the codec parameters, so trim it hard.
        args.Append("-probesize 1000000 -analyzeduration 1000000 ");
        args.Append($"-rtsp_transport {transport} ");
        args.Append("-timeout 5000000 ");
        args.Append($"-i \"{input}\" ");
        args.Append("-an ");
        if (transcode)
        {
            // Speed over quality: cheapest x264 settings, no encoder
            // lookahead, a keyframe forced every segment so HLS latency is
            // bound by hls_time instead of the camera's (often 2-4s) GOP.
            // Width is capped so an accidental main-stream URL doesn't
            // melt the CPU; yuv420p keeps WebView/MSE decoders happy;
            // threads capped so N encoders cold-starting together don't
            // starve each other (and the whole box) of cores.
            args.Append("-c:v libx264 -preset ultrafast -tune zerolatency -threads 2 ");
            args.Append("-crf 28 -maxrate 1500k -bufsize 3000k -pix_fmt yuv420p ");
            // Optional frame-rate cap: encode cost is ~linear in fps, so
            // capping (e.g. 12) noticeably cuts CPU on a weak box at the cost
            // of motion smoothness. 0 = leave the camera's own rate untouched
            // (default), so this is opt-in and changes nothing unless set.
            var maxFps = _options.StreamMaxFps;
            var fpsFilter = maxFps > 0 ? $",fps={maxFps}" : "";
            args.Append($"-vf \"scale='min(1280,iw)':-2{fpsFilter}\" ");
            args.Append($"-force_key_frames \"expr:gte(t,n_forced*{segTime})\" ");
        }
        else
        {
            args.Append("-c:v copy ");
        }
        args.Append("-f hls ");
        args.Append($"-hls_time {segTime} ");
        args.Append($"-hls_list_size {listSize} ");
        args.Append("-hls_flags delete_segments+append_list+omit_endlist+independent_segments ");
        args.Append($"-hls_segment_filename \"{Path.Combine(outDir, "seg_%05d.ts")}\" ");
        args.Append($"\"{Path.Combine(outDir, "index.m3u8")}\"");

        var psi = new ProcessStartInfo
        {
            FileName = "ffmpeg",
            Arguments = args.ToString(),
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.ErrorDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data) || IsBenignFfmpegNoise(e.Data)) return;
            _log.LogWarning("[ffmpeg {Id}] {Msg}", cameraId, RedactCredentials(e.Data));
        };
        proc.OutputDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data) || IsBenignFfmpegNoise(e.Data)) return;
            _log.LogInformation("[ffmpeg {Id}] {Msg}", cameraId, RedactCredentials(e.Data));
        };

        _log.LogInformation(
            "Starting ffmpeg for camera {Id} ({Name}, {Mode}).",
            cameraId, camera.Name, transcode ? "low-latency transcode" : "stream copy");
        proc.Start();
        proc.BeginErrorReadLine();
        proc.BeginOutputReadLine();

        return new StreamSession(cameraId, proc, outDir, DateTime.UtcNow, transcode);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            var idleThreshold = TimeSpan.FromSeconds(Math.Max(5, _options.IdleShutdownSeconds));
            List<StreamSession> toStop = new();
            lock (_gate)
            {
                foreach (var (id, s) in _sessions)
                {
                    if (s.Process.HasExited)
                    {
                        toStop.Add(s);
                    }
                    else if (DateTime.UtcNow - s.LastAccessUtc > idleThreshold)
                    {
                        toStop.Add(s);
                    }
                }
                foreach (var s in toStop) _sessions.Remove(s.CameraId);
            }

            foreach (var s in toStop)
            {
                await StopSessionAsync(s, reason: s.Process.HasExited ? "exited" : "idle");
            }
        }

        List<StreamSession> remaining;
        lock (_gate)
        {
            remaining = _sessions.Values.ToList();
            _sessions.Clear();
        }
        foreach (var s in remaining)
        {
            await StopSessionAsync(s, reason: "shutdown");
        }
    }

    private async Task StopSessionAsync(StreamSession session, string reason)
    {
        try
        {
            if (!session.Process.HasExited)
            {
                _log.LogInformation("Stopping ffmpeg for camera {Id} ({Reason}).", session.CameraId, reason);
                try { session.Process.Kill(entireProcessTree: true); } catch { /* best effort */ }
                using var waitCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                try { await session.Process.WaitForExitAsync(waitCts.Token); }
                catch { /* best effort */ }
            }
        }
        finally
        {
            session.Process.Dispose();
            CleanDirectory(session.OutputDir);
        }
    }

    private static void CleanDirectory(string dir)
    {
        try
        {
            if (!Directory.Exists(dir)) return;
            foreach (var f in Directory.EnumerateFiles(dir))
            {
                try { File.Delete(f); } catch { /* best effort */ }
            }
        }
        catch { /* best effort */ }
    }

    // ffmpeg echoes the input URL — user:pass@host included — in error
    // lines, and these land in the add-on log visible from the HA UI.
    private static readonly Regex UrlCredentials =
        new(@"(rtsps?://)[^@/\s]+@", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static string RedactCredentials(string line) =>
        UrlCredentials.Replace(line, "$1***@");

    // Defense in depth: even with `-loglevel error`, drop the high-volume
    // benign line families here so they can never re-flood the logger (and
    // stall the web server) if verbosity is ever raised again. Cheap
    // Ordinal checks run on the stderr callback thread before the regex/log.
    private static bool IsBenignFfmpegNoise(string line) =>
        line.Contains("VBV underflow", StringComparison.Ordinal)     // per-frame rate-control noise
        || line.Contains("CSeq", StringComparison.Ordinal);          // benign RTSP sequence hiccups

    private static string BuildRtspUrl(CameraOptions cam)
    {
        if (string.IsNullOrWhiteSpace(cam.Url)) return cam.Url;
        if (!Uri.TryCreate(cam.Url, UriKind.Absolute, out var uri)) return cam.Url;
        if (!string.IsNullOrEmpty(uri.UserInfo)) return cam.Url;
        if (string.IsNullOrWhiteSpace(cam.Username)) return cam.Url;

        var user = Uri.EscapeDataString(cam.Username);
        var pass = string.IsNullOrEmpty(cam.Password) ? "" : ":" + Uri.EscapeDataString(cam.Password);
        var hostPort = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
        return $"{uri.Scheme}://{user}{pass}@{hostPort}{uri.PathAndQuery}";
    }

    public async ValueTask DisposeAsync()
    {
        List<StreamSession> remaining;
        lock (_gate)
        {
            remaining = _sessions.Values.ToList();
            _sessions.Clear();
        }
        foreach (var s in remaining)
        {
            await StopSessionAsync(s, reason: "dispose");
        }
    }

    private sealed class StreamSession
    {
        public StreamSession(string cameraId, Process process, string outputDir, DateTime lastAccessUtc, bool transcoded)
        {
            CameraId = cameraId;
            Process = process;
            OutputDir = outputDir;
            LastAccessUtc = lastAccessUtc;
            Transcoded = transcoded;
        }

        public string CameraId { get; }
        public Process Process { get; }
        public string OutputDir { get; }
        public DateTime LastAccessUtc { get; set; }
        public bool Transcoded { get; }
    }
}
