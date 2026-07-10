using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using PzmHomeDashboard.Models;
using PzmHomeDashboard.Services;

namespace PzmHomeDashboard.Controllers;

// Exposes generic access to Home Assistant entities so custom tiles (added
// from the UI) can list what's available, read state, and trigger actions.
[ApiController]
[Route("api/ha")]
public sealed class EntitiesController : ControllerBase
{
    private readonly HomeAssistantClient _client;

    public EntitiesController(HomeAssistantClient client)
    {
        _client = client;
    }

    [HttpGet("entities")]
    public async Task<IActionResult> ListEntities(
        [FromQuery] string? domains,
        [FromQuery] string? search,
        [FromQuery] int limit = 500,
        CancellationToken ct = default)
    {
        var all = await _client.GetAllStatesAsync(ct);
        IEnumerable<HaEntitySummary> filtered = all;

        if (!string.IsNullOrWhiteSpace(domains))
        {
            var set = new HashSet<string>(
                domains.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                StringComparer.OrdinalIgnoreCase);
            filtered = filtered.Where(e => set.Contains(e.Domain));
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var q = search.Trim();
            filtered = filtered.Where(e =>
                e.EntityId.Contains(q, StringComparison.OrdinalIgnoreCase)
                || (e.FriendlyName ?? "").Contains(q, StringComparison.OrdinalIgnoreCase));
        }

        var payload = filtered
            .OrderBy(e => e.Domain, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.EntityId, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(limit, 1, 2000))
            .ToArray();

        Response.Headers["Cache-Control"] = "no-store";
        return Ok(payload);
    }

    public sealed record StatesReq(string[]? Ids);

    [HttpPost("entity/state")]
    public async Task<IActionResult> States([FromBody] StatesReq body, CancellationToken ct)
    {
        var ids = body?.Ids ?? Array.Empty<string>();
        var tasks = ids.Where(id => !string.IsNullOrWhiteSpace(id))
                       .Distinct()
                       .Select(id => _client.GetStateAsync(id, ct))
                       .ToArray();
        var results = await Task.WhenAll(tasks);
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(results);
    }

    public sealed record ActionReq(
        string? EntityId,
        string? Domain,
        string? Service,
        JsonElement Data);

    [HttpPost("entity/action")]
    public async Task<IActionResult> Action([FromBody] ActionReq body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.EntityId))
            return BadRequest(new { error = "entityId required" });

        var dot = body.EntityId.IndexOf('.');
        if (dot <= 0) return BadRequest(new { error = "Invalid entityId" });
        var domain = string.IsNullOrWhiteSpace(body.Domain) ? body.EntityId[..dot] : body.Domain;
        var service = string.IsNullOrWhiteSpace(body.Service) ? DefaultService(domain) : body.Service;

        var data = new Dictionary<string, object?> { ["entity_id"] = body.EntityId };
        if (body.Data.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in body.Data.EnumerateObject())
            {
                if (prop.NameEquals("entity_id")) continue;
                data[prop.Name] = JsonToObject(prop.Value);
            }
        }

        var ok = await _client.CallServiceAsync(domain, service, data, ct);
        return ok ? Ok(new { ok = true }) : StatusCode(502, new { error = "HA call failed." });
    }

    private static string DefaultService(string domain) => domain switch
    {
        "switch"        => "toggle",
        "input_boolean" => "toggle",
        "light"         => "toggle",
        "fan"           => "toggle",
        "cover"         => "toggle",
        "button"        => "press",
        "input_button"  => "press",
        "script"        => "turn_on",
        "scene"         => "turn_on",
        "automation"    => "trigger",
        "lock"          => "unlock",
        _               => "turn_on",
    };

    // Recursively convert a JsonElement into a native CLR shape so that
    // downstream JsonSerializer.Serialize(...) produces the payload HA
    // expects. This used to fall through to GetRawText() for arrays and
    // objects, which then re-serialized to a *string* containing JSON —
    // so `rgb_color: [0,111,255]` reached HA as `"rgb_color":"[0,111,255]"`
    // and the service call was ignored. Arrays/objects now round-trip
    // correctly.
    private static object? JsonToObject(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.String => el.GetString(),
        JsonValueKind.Number => el.TryGetInt64(out var i) ? i : el.GetDouble(),
        JsonValueKind.True   => true,
        JsonValueKind.False  => false,
        JsonValueKind.Null   => null,
        JsonValueKind.Array  => el.EnumerateArray().Select(JsonToObject).ToArray(),
        JsonValueKind.Object => el.EnumerateObject()
            .ToDictionary(p => p.Name, p => JsonToObject(p.Value)),
        _ => el.GetRawText(),
    };
}
