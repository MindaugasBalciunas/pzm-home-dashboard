using Microsoft.AspNetCore.Mvc;
using PzmHomeDashboard.Services;

namespace PzmHomeDashboard.Controllers;

[ApiController]
[Route("hls")]
public sealed class HlsController : ControllerBase
{
    private readonly StreamManager _streams;

    public HlsController(StreamManager streams)
    {
        _streams = streams;
    }

    [HttpGet("{cameraId}/index.m3u8")]
    public async Task<IActionResult> Playlist(string cameraId, CancellationToken ct)
    {
        var path = await _streams.EnsurePlaylistAsync(cameraId, ct);
        if (path is null || !System.IO.File.Exists(path))
        {
            return NotFound();
        }

        Response.Headers["Cache-Control"] = "no-store";
        var bytes = await System.IO.File.ReadAllBytesAsync(path, ct);
        return File(bytes, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{cameraId}/{segment}")]
    public IActionResult Segment(string cameraId, string segment)
    {
        if (!IsSafeSegmentName(segment))
        {
            return BadRequest();
        }

        _streams.Touch(cameraId);
        var path = Path.Combine(_streams.GetOutputDir(cameraId), segment);
        if (!System.IO.File.Exists(path))
        {
            return NotFound();
        }

        var contentType = segment.EndsWith(".ts", StringComparison.OrdinalIgnoreCase)
            ? "video/mp2t"
            : segment.EndsWith(".m4s", StringComparison.OrdinalIgnoreCase)
                ? "video/iso.segment"
                : "application/octet-stream";
        return PhysicalFile(path, contentType, enableRangeProcessing: true);
    }

    private static bool IsSafeSegmentName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return false;
        if (name.Contains("..") || name.Contains('/') || name.Contains('\\')) return false;
        foreach (var ch in name)
        {
            if (!(char.IsLetterOrDigit(ch) || ch is '_' or '-' or '.'))
            {
                return false;
            }
        }
        return true;
    }
}
