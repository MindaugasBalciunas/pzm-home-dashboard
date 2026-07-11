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

        // Alarm, every gate (entity + contact) and every zone all resolve
        // from the one shared /states snapshot, so the whole security card is
        // a single HA fetch rather than ~17 per-entity requests.
        async Task<HaStateDto?> ResolveAlarmAsync(string panel)
            => await _client.GetStateCachedAsync(panel, ct);
        var alarmTask = string.IsNullOrWhiteSpace(sec.AlarmPanel)
            ? Task.FromResult<HaStateDto?>(null)
            : ResolveAlarmAsync(sec.AlarmPanel!);

        var gateTasks = sec.Gates.Select(async g =>
        {
            var entity = EffectiveEntity(g.Name, g.Entity);
            var contact = EffectiveContact(g.Contact);
            var contactKind = EffectiveContactKind(contact, g.ContactKind);
            return new
            {
                g.Name,
                Entity = entity,
                g.Icon,
                Contact = contact,
                ContactKind = contactKind,
                state = string.IsNullOrWhiteSpace(entity)
                    ? null
                    : await _client.GetStateCachedAsync(entity!, ct),
                contactState = string.IsNullOrWhiteSpace(contact)
                    ? null
                    : await _client.GetStateCachedAsync(contact!, ct),
            };
        }).ToArray();

        var zoneTasks = sec.Zones.Select(async z => new
        {
            z.Name,
            z.Entity,
            z.Kind,
            state = string.IsNullOrWhiteSpace(z.Entity)
                ? null
                : await _client.GetStateCachedAsync(z.Entity, ct),
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
        var entity = EffectiveEntity(gate.Name, gate.Entity);
        if (string.IsNullOrWhiteSpace(entity))
        {
            return BadRequest(new { error = "Gate has no entity configured." });
        }

        var (domain, service) = ResolveGateService(entity!);
        var ok = await _client.CallServiceAsync(
            domain, service, new { entity_id = entity }, ct);
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

    // Same stale-options story as the contact remaps below: the Gate opener
    // chip must control the opener's own switch, whatever entity the
    // install's saved options still carry for it.
    private static string? EffectiveEntity(string? name, string? entity)
        => string.Equals(name, "Gate opener", StringComparison.OrdinalIgnoreCase)
            ? "switch.gate_opener_switch_1"
            : entity;

    // Saved add-on options aren't refreshed when defaults change, and older
    // installs still carry the Eldes garage zone as the gate contact — that
    // zone tracks the alarm panel, not the physical door. Remap it to the
    // dedicated door contact so the gate chip shows the actual door state
    // (config.yaml defaults carry the same entity for fresh installs).
    private static string? EffectiveContact(string? contact)
    {
        if (string.Equals(contact, "binary_sensor.esim364_garazo_vartai",
                StringComparison.OrdinalIgnoreCase))
            return "binary_sensor.garage_gates_contact_sensor_door";
        // The access-control lock sensor turned out not to track the gate
        // opener; the opener's own switch state does. Remap installs whose
        // saved options still carry the old contact.
        if (string.Equals(contact, "binary_sensor.access_control_lock",
                StringComparison.OrdinalIgnoreCase))
            return "switch.gate_opener_switch_1";
        return contact;
    }

    // Keep the status wording in sync when a contact gets remapped: the
    // opener switch reports on/off (engaged/idle), not locked/unlocked.
    private static string? EffectiveContactKind(string? contact, string? kind)
        => string.Equals(contact, "switch.gate_opener_switch_1",
                StringComparison.OrdinalIgnoreCase)
            ? "gate"
            : kind;

    // Map an entity's domain to the right press/toggle service. Momentary
    // relays are best represented in HA as `switch` or `button`; pulse-style
    // covers use `cover.open_cover`; `script`/`input_boolean` are common
    // wrappers for Eldes outputs.
    private static (string domain, string service) ResolveGateService(string entityId)
    {
        // The gate opener's switch latches (on = gate engaged) and its chip
        // shows Open/Closed from that same switch — a tap must be able to
        // close it again, so it toggles instead of the momentary turn_on
        // the Eldes relays use.
        if (string.Equals(entityId, "switch.gate_opener_switch_1",
                StringComparison.OrdinalIgnoreCase))
            return ("switch", "toggle");

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
