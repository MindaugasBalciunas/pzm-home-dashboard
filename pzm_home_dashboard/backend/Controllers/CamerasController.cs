using Microsoft.AspNetCore.Mvc;
using PzmHomeDashboard.Services;

namespace PzmHomeDashboard.Controllers;

[ApiController]
[Route("api/cameras")]
public sealed class CamerasController : ControllerBase
{
    private readonly CameraRegistry _registry;
    private readonly CameraSnapshotService _snapshots;

    public CamerasController(CameraRegistry registry, CameraSnapshotService snapshots)
    {
        _registry = registry;
        _snapshots = snapshots;
    }

    [HttpGet]
    public IActionResult List() => Ok(_registry.List());

    // A still JPEG used as the video placeholder while the stream warms up.
    // 404 when the camera has no reachable snapshot (non-Reolink, offline) —
    // the tile then falls back to its spinner overlay.
    [HttpGet("{cameraId}/snapshot")]
    public async Task<IActionResult> Snapshot(string cameraId, CancellationToken ct)
    {
        var bytes = await _snapshots.GetJpegAsync(cameraId, ct);
        if (bytes is null || bytes.Length == 0) return NotFound();
        Response.Headers["Cache-Control"] = "no-store";
        return File(bytes, "image/jpeg");
    }
}
