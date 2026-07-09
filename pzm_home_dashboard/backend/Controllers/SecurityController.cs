using Microsoft.AspNetCore.Mvc;
using PzmHomeDashboard.Models;
using PzmHomeDashboard.Services;

namespace PzmHomeDashboard.Controllers;

[ApiController]
[Route("api/ha/security")]
public sealed class SecurityController : ControllerBase
{
    private readonly HomeAssistantClient _client;
    private readonly HomeAssistantOptions _opts;

    public SecurityController(HomeAssistantClient client, HomeAssistantOptions opts)
    {
        _client = client;
        _opts = opts;
    }

    [HttpGet("")]
    public async Task<IActionResult> Snapshot(CancellationToken ct)
    {
        var sec = _opts.Security;

        var alarmTask = string.IsNullOrWhiteSpace(sec.AlarmPanel)
            ? Task.FromResult<HaStateDto?>(null)
            : _client.GetStateAsync(sec.AlarmPanel!, ct);

        var gateTasks = sec.Gates.Select(async g => new
        {
            g.Name,
            g.Entity,
            g.Icon,
            g.Contact,
            state = string.IsNullOrWhiteSpace(g.Entity)
                ? null
                : await _client.GetStateAsync(g.Entity, ct),
            contactState = string.IsNullOrWhiteSpace(g.Contact)
                ? null
                : await _client.GetStateAsync(g.Contact!, ct),
        }).ToArray();

        var zoneTasks = sec.Zones.Select(async z => new
        {
            z.Name,
            z.Entity,
            z.Kind,
            state = string.IsNullOrWhiteSpace(z.Entity)
                ? null
                : await _client.GetStateAsync(z.Entity, ct),
        }).ToArray();

        await Task.WhenAll(
            new[] { (Task)alarmTask }
                .Concat(gateTasks.Cast<Task>())
                .Concat(zoneTasks.Cast<Task>()));

        Response.Headers["Cache-Control"] = "no-store";
        return Ok(new
        {
            configured = _client.IsConfigured,
            alarm = alarmTask.Result,
            gates = gateTasks.Select(t => t.Result).ToArray(),
            zones = zoneTasks.Select(t => t.Result).ToArray(),
        });
    }

    [HttpPost("gate/{index:int}")]
    public async Task<IActionResult> TriggerGate(int index, CancellationToken ct)
    {
        var gates = _opts.Security.Gates;
        if (index < 0 || index >= gates.Count)
        {
            return NotFound(new { error = "Gate index out of range." });
        }
        var gate = gates[index];
        if (string.IsNullOrWhiteSpace(gate.Entity))
        {
            return BadRequest(new { error = "Gate has no entity configured." });
        }

        var (domain, service) = ResolveGateService(gate.Entity);
        var ok = await _client.CallServiceAsync(
            domain, service, new { entity_id = gate.Entity }, ct);
        return ok ? Ok(new { ok = true }) : StatusCode(502, new { error = "HA call failed." });
    }

    // Body: { "action": "arm_home" | "arm_away" | "arm_night" | "disarm", "code": "1234" }
    public sealed record AlarmRequest(string Action, string? Code);

    [HttpPost("alarm")]
    public async Task<IActionResult> Alarm([FromBody] AlarmRequest body, CancellationToken ct)
    {
        var panel = _opts.Security.AlarmPanel;
        if (string.IsNullOrWhiteSpace(panel))
        {
            return BadRequest(new { error = "No alarm_panel configured." });
        }
        var action = (body.Action ?? "").Trim().ToLowerInvariant();
        var service = action switch
        {
            "arm_home"  => "alarm_arm_home",
            "arm_away"  => "alarm_arm_away",
            "arm_night" => "alarm_arm_night",
            "disarm"    => "alarm_disarm",
            _ => null,
        };
        if (service is null) return BadRequest(new { error = "Unknown action." });

        // Prefer the code sent from the client; fall back to the one configured
        // in options so simple UIs (a Disarm button) can work without prompting.
        var code = !string.IsNullOrEmpty(body.Code) ? body.Code : _opts.Security.AlarmCode;
        object data = string.IsNullOrEmpty(code)
            ? new { entity_id = panel! }
            : new { entity_id = panel!, code };

        var ok = await _client.CallServiceAsync("alarm_control_panel", service, data, ct);
        return ok ? Ok(new { ok = true }) : StatusCode(502, new { error = "HA call failed." });
    }

    // Map an entity's domain to the right press/toggle service. Momentary
    // relays are best represented in HA as `switch` or `button`; pulse-style
    // covers use `cover.open_cover`; `script`/`input_boolean` are common
    // wrappers for Eldes outputs.
    private static (string domain, string service) ResolveGateService(string entityId)
    {
        var dot = entityId.IndexOf('.');
        var domain = dot > 0 ? entityId[..dot] : "switch";
        return domain switch
        {
            "switch"        => ("switch", "turn_on"),
            "input_boolean" => ("input_boolean", "turn_on"),
            "button"        => ("button", "press"),
            "script"        => ("script", "turn_on"),
            "cover"         => ("cover", "open_cover"),
            "lock"          => ("lock", "unlock"),
            _               => (domain, "turn_on"),
        };
    }
}
