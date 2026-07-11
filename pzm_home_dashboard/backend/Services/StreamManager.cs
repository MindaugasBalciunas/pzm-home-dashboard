using System.Diagnostics;
using System.Text;
using PzmHomeDashboard.Models;

namespace PzmHomeDashboard.Services;

public sealed class StreamManager : BackgroundService, IAsyncDisposable
{
    private readonly DashboardOptions _options;
    private readonly CameraRegistry _registry;
    private readonly ILogger<StreamManager> _log;
    private readonly string _hlsRoot;
    private readonly Dictionary<string, StreamSession> _sessions = new(StringComparer.OrdinalIgnoreCase);
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

        StreamSession session;
        lock (_gate)
        {
            if (!_sessions.TryGetValue(cameraId, out session!))
            {
                session = StartFfmpeg(cameraId, camera);
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
                return playlist;
            }
            if (session.Process.HasExited)
            {
                _log.LogWarning(
                    "ffmpeg for camera {Id} exited before producing a playlist (code {Code}).",
                    cameraId, session.Process.ExitCode);
                lock (_gate) _sessions.Remove(cameraId);
                return null;
            }
            try { await Task.Delay(200, ct); }
            catch (OperationCanceledException) { return null; }
        }

        _log.LogWarning("Timed out waiting for HLS playlist for camera {Id}.", cameraId);
        return null;
    }

    private StreamSession StartFfmpeg(string cameraId, CameraOptions camera)
    {
        var outDir = GetOutputDir(cameraId);
        Directory.CreateDirectory(outDir);
        CleanDirectory(outDir);

        var input = BuildRtspUrl(camera);
        var transport = string.IsNullOrWhiteSpace(camera.Transport) ? "tcp" : camera.Transport;
        // Low-latency mode pins segments at 1s — the whole point of the
        // re-encode is a keyframe cadence shorter than the camera's GOP,
        // and stored add-on options may still carry the old 2s default.
        var segTime = _options.LowLatencyTranscode ? 1 : Math.Max(1, _options.HlsSegmentSeconds);
        var listSize = Math.Max(2, _options.HlsListSize);

        var args = new StringBuilder();
        args.Append("-nostdin -hide_banner -loglevel warning ");
        args.Append("-fflags nobuffer -flags low_delay ");
        // Defaults are 5s / 5MB of probing before the first frame; RTSP's
        // SDP already carries the codec parameters, so trim it hard.
        args.Append("-probesize 1000000 -analyzeduration 1000000 ");
        args.Append($"-rtsp_transport {transport} ");
        args.Append("-timeout 5000000 ");
        args.Append($"-i \"{input}\" ");
        args.Append("-an ");
        if (_options.LowLatencyTranscode)
        {
            // Speed over quality: cheapest x264 settings, no encoder
            // lookahead, a keyframe forced every segment so HLS latency is
            // bound by hls_time instead of the camera's (often 2-4s) GOP.
            // Width is capped so an accidental main-stream URL doesn't
            // melt the CPU; yuv420p keeps WebView/MSE decoders happy.
            args.Append("-c:v libx264 -preset ultrafast -tune zerolatency ");
            args.Append("-crf 28 -maxrate 1500k -bufsize 3000k -pix_fmt yuv420p ");
            args.Append("-vf \"scale='min(1280,iw)':-2\" ");
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
            if (!string.IsNullOrEmpty(e.Data))
            {
                _log.LogWarning("[ffmpeg {Id}] {Msg}", cameraId, e.Data);
            }
        };
        proc.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                _log.LogInformation("[ffmpeg {Id}] {Msg}", cameraId, e.Data);
            }
        };

        _log.LogInformation("Starting ffmpeg for camera {Id} ({Name}).", cameraId, camera.Name);
        proc.Start();
        proc.BeginErrorReadLine();
        proc.BeginOutputReadLine();

        return new StreamSession(cameraId, proc, outDir, DateTime.UtcNow);
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
                try { await session.Process.WaitForExitAsync(new CancellationTokenSource(TimeSpan.FromSeconds(5)).Token); }
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
        public StreamSession(string cameraId, Process process, string outputDir, DateTime lastAccessUtc)
        {
            CameraId = cameraId;
            Process = process;
            OutputDir = outputDir;
            LastAccessUtc = lastAccessUtc;
        }

        public string CameraId { get; }
        public Process Process { get; }
        public string OutputDir { get; }
        public DateTime LastAccessUtc { get; set; }
    }
}
