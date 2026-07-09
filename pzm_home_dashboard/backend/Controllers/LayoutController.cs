using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using PzmHomeDashboard.Services;

namespace PzmHomeDashboard.Controllers;

[ApiController]
[Route("api/layout")]
public sealed class LayoutController : ControllerBase
{
    private readonly LayoutStore _store;

    public LayoutController(LayoutStore store)
    {
        _store = store;
    }

    [HttpGet]
    public IActionResult Get()
    {
        var snap = _store.Get();
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(new { revision = snap.Revision, layout = snap.Layout });
    }

    public sealed class LayoutBody
    {
        public JsonElement Layout { get; set; }
    }

    [HttpPut]
    public async Task<IActionResult> Put([FromBody] LayoutBody body, CancellationToken ct)
    {
        var snap = await _store.SetAsync(body.Layout, ct);
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(new { revision = snap.Revision, layout = snap.Layout });
    }

    // Server-sent events. Each event body is the same shape the GET returns,
    // so late-joining clients trivially reconcile by ignoring older revisions.
    [HttpGet("events")]
    public async Task Events(CancellationToken ct)
    {
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["Content-Type"] = "text/event-stream";
        Response.Headers["Connection"] = "keep-alive";
        // Home Assistant / nginx don't buffer SSE when this hint is present.
        Response.Headers["X-Accel-Buffering"] = "no";

        await SendSnap(_store.Get(), ct);

        var ch = _store.Subscribe();
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var read = ch.Reader.WaitToReadAsync(ct).AsTask();
                var ping = Task.Delay(TimeSpan.FromSeconds(15), ct);
                var done = await Task.WhenAny(read, ping);
                if (done == ping)
                {
                    if (ct.IsCancellationRequested) break;
                    await Response.WriteAsync(": ping\n\n", ct);
                    await Response.Body.FlushAsync(ct);
                    continue;
                }
                if (!await read) break;
                while (ch.Reader.TryRead(out var snap))
                {
                    await SendSnap(snap, ct);
                }
            }
        }
        catch (OperationCanceledException) { /* client disconnected */ }
        finally
        {
            _store.Unsubscribe(ch);
        }
    }

    private async Task SendSnap(LayoutSnapshot snap, CancellationToken ct)
    {
        var payload = JsonSerializer.Serialize(new { revision = snap.Revision, layout = snap.Layout });
        await Response.WriteAsync("data: " + payload + "\n\n", ct);
        await Response.Body.FlushAsync(ct);
    }
}
