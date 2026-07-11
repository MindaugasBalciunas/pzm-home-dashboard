using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using PzmHomeDashboard.Models;

namespace PzmHomeDashboard.Services;

// Fetches a still JPEG from a Reolink camera's CGI snapshot endpoint so the UI
// can show a real frame as a placeholder while the HLS stream warms up,
// instead of a black rectangle. Credentials stay server-side — the browser
// only ever sees the proxied /api/cameras/{id}/snapshot URL, never the camera
// password (the same reason the RTSP URL is never sent to the client).
// Snapshots (and misses) are cached briefly so many tiles / reconnects don't
// hammer the camera's CGI.
public sealed class CameraSnapshotService
{
    private readonly IHttpClientFactory _factory;
    private readonly CameraRegistry _registry;
    private readonly ILogger<CameraSnapshotService> _log;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(5);
    private readonly ConcurrentDictionary<string, CachedShot> _cache =
        new(StringComparer.OrdinalIgnoreCase);

    public CameraSnapshotService(
        IHttpClientFactory factory, CameraRegistry registry, ILogger<CameraSnapshotService> log)
    {
        _factory = factory;
        _registry = registry;
        _log = log;
    }

    public async Task<byte[]?> GetJpegAsync(string cameraId, CancellationToken ct)
    {
        if (!_registry.TryGet(cameraId, out var cam)) return null;
        if (_cache.TryGetValue(cameraId, out var hit) && DateTime.UtcNow - hit.At < CacheTtl)
            return hit.Bytes;

        var url = BuildSnapshotUrl(cam);
        if (url is null) return Cache(cameraId, null);

        try
        {
            var http = _factory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(5);
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode) return Cache(cameraId, null);
            var mediaType = resp.Content.Headers.ContentType?.MediaType ?? "";
            if (!mediaType.StartsWith("image", StringComparison.OrdinalIgnoreCase))
                return Cache(cameraId, null);
            var bytes = await resp.Content.ReadAsByteArrayAsync(ct);
            return Cache(cameraId, bytes.Length > 0 ? bytes : null);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Snapshot fetch failed for {Id}", cameraId);
            return Cache(cameraId, null);
        }
    }

    private byte[]? Cache(string id, byte[]? bytes)
    {
        _cache[id] = new CachedShot(bytes, DateTime.UtcNow);
        return bytes;
    }

    // Reolink still-image CGI. The channel is derived from the RTSP path
    // (h264Preview_0N_… → channel N-1); credentials come from the URL's
    // userinfo if present, else the camera's username/password fields.
    private static readonly Regex ChannelRe = new(@"_(\d{2})_", RegexOptions.Compiled);

    private static string? BuildSnapshotUrl(CameraOptions cam)
    {
        if (!Uri.TryCreate(cam.Url, UriKind.Absolute, out var uri)) return null;
        if (string.IsNullOrEmpty(uri.Host)) return null;

        string user, pass;
        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            var parts = uri.UserInfo.Split(':', 2);
            user = Uri.UnescapeDataString(parts[0]);
            pass = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "";
        }
        else
        {
            user = cam.Username ?? "";
            pass = cam.Password ?? "";
        }

        var channel = 0;
        var m = ChannelRe.Match(uri.AbsolutePath);
        if (m.Success && int.TryParse(m.Groups[1].Value, out var n) && n >= 1) channel = n - 1;

        var query = $"cmd=Snap&channel={channel}&rs=pzm"
            + $"&user={Uri.EscapeDataString(user)}&password={Uri.EscapeDataString(pass)}";
        var scheme = uri.Scheme == "rtsps" || uri.Scheme == "https" ? "https" : "http";
        return $"{scheme}://{uri.Host}/cgi-bin/api.cgi?{query}";
    }

    private readonly record struct CachedShot(byte[]? Bytes, DateTime At);
}
