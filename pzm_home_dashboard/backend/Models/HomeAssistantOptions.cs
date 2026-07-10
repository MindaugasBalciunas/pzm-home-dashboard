using System.Text.Json.Serialization;

namespace PzmHomeDashboard.Models;

public sealed class HomeAssistantOptions
{
    [JsonPropertyName("base_url")]
    public string? BaseUrl { get; set; } = "http://homeassistant.local:8123";

    [JsonPropertyName("token")]
    public string? Token { get; set; }

    [JsonPropertyName("use_supervisor")]
    public bool UseSupervisor { get; set; }

    [JsonPropertyName("solar")]
    public SolarEntities Solar { get; set; } = new();

    [JsonPropertyName("security")]
    public SecurityEntities Security { get; set; } = new();
}

public sealed class SecurityEntities
{
    [JsonPropertyName("alarm_panel")]
    public string? AlarmPanel { get; set; }

    [JsonPropertyName("alarm_code")]
    public string? AlarmCode { get; set; }

    [JsonPropertyName("gates")]
    public List<GateEntity> Gates { get; set; } = new();

    [JsonPropertyName("zones")]
    public List<ZoneEntity> Zones { get; set; } = new();
}

public sealed class GateEntity
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    // The controlled entity (e.g. switch.eldes_output_1, cover.gate,
    // button.gate, script.gate_toggle, input_boolean.gate).
    [JsonPropertyName("entity")]
    public string Entity { get; set; } = "";

    // Optional contact sensor showing open/closed (binary_sensor).
    [JsonPropertyName("contact")]
    public string? Contact { get; set; }

    // Optional kind for the contact sensor. Same set as ZoneEntity.Kind
    // (contact / door / window / lock / …); drives the label the client
    // shows on the button. Defaults to a generic contact (Open/Closed).
    [JsonPropertyName("contact_kind")]
    public string? ContactKind { get; set; }

    // Optional icon override (mdi:garage / mdi:gate). Client-side hint.
    [JsonPropertyName("icon")]
    public string? Icon { get; set; }
}

public sealed class ZoneEntity
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("entity")]
    public string Entity { get; set; } = "";

    // Semantic kind used by the client to pick a localised status label.
    // Recognised: contact, door, window, motion, fire, gas, glass, flood.
    // Anything else falls through to a generic on/off translation.
    [JsonPropertyName("kind")]
    public string? Kind { get; set; }
}

public sealed class SolarEntities
{
    [JsonPropertyName("import")]
    public string? Import { get; set; }

    [JsonPropertyName("export")]
    public string? Export { get; set; }

    [JsonPropertyName("house_use")]
    public string? HouseUse { get; set; }

    [JsonPropertyName("pv_total")]
    public string? PvTotal { get; set; }

    [JsonPropertyName("pv1")]
    public string? Pv1 { get; set; }

    [JsonPropertyName("pv2")]
    public string? Pv2 { get; set; }

    // Cumulative energy (kWh) — today + lifetime.
    [JsonPropertyName("today_solar")]
    public string? TodaySolar { get; set; }

    [JsonPropertyName("today_export")]
    public string? TodayExport { get; set; }

    [JsonPropertyName("today_import")]
    public string? TodayImport { get; set; }

    [JsonPropertyName("total_solar")]
    public string? TotalSolar { get; set; }

    // PV string detail (voltage/current per MPPT).
    [JsonPropertyName("pv1_voltage")]
    public string? Pv1Voltage { get; set; }

    [JsonPropertyName("pv2_voltage")]
    public string? Pv2Voltage { get; set; }

    [JsonPropertyName("pv1_current")]
    public string? Pv1Current { get; set; }

    [JsonPropertyName("pv2_current")]
    public string? Pv2Current { get; set; }

    // Signed grid power (positive = import, negative = export).
    [JsonPropertyName("measured_power")]
    public string? MeasuredPower { get; set; }

    // Inverter status/health.
    [JsonPropertyName("run_mode")]
    public string? RunMode { get; set; }

    [JsonPropertyName("grid_runtime")]
    public string? GridRuntime { get; set; }

    [JsonPropertyName("battery_power")]
    public string? BatteryPower { get; set; }

    [JsonPropertyName("battery_soc")]
    public string? BatterySoc { get; set; }

    // P1 utility meter (grid-side measurement). Solax figures are inverter-
    // side; the P1 meter is what the DSO bills us on. Six sensors: total
    // import/export plus per-tariff (day / night) breakdown.
    [JsonPropertyName("p1_import_total")]
    public string? P1ImportTotal { get; set; }

    [JsonPropertyName("p1_import_t1")]
    public string? P1ImportT1 { get; set; }

    [JsonPropertyName("p1_import_t2")]
    public string? P1ImportT2 { get; set; }

    [JsonPropertyName("p1_export_total")]
    public string? P1ExportTotal { get; set; }

    [JsonPropertyName("p1_export_t1")]
    public string? P1ExportT1 { get; set; }

    [JsonPropertyName("p1_export_t2")]
    public string? P1ExportT2 { get; set; }

    // One-tap toggle chips rendered inside the Electricity tile. Any HA
    // domain works — the backend service dispatch handles switch/light/
    // input_boolean/script/cover/lock uniformly.
    [JsonPropertyName("controls")]
    public List<ElectricControl> Controls { get; set; } = new();
}

public sealed class ElectricControl
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("entity")]
    public string Entity { get; set; } = "";

    // Optional icon key from the shared tile-icon catalog (auto, light,
    // lamp, torch, sign, switch, rgb, …). "auto" or null falls back to a
    // domain-derived glyph.
    [JsonPropertyName("icon")]
    public string? Icon { get; set; }
}

public sealed record HaStateDto(
    [property: JsonPropertyName("entityId")] string EntityId,
    [property: JsonPropertyName("state")] string? State,
    [property: JsonPropertyName("unit")] string? Unit,
    [property: JsonPropertyName("friendlyName")] string? FriendlyName,
    [property: JsonPropertyName("light")] LightAttrs? Light = null);

// Compact bag of light attributes surfaced to the frontend when the
// entity is a light. `null` means "not a light" or attributes missing —
// the SimpleTile falls back to plain toggle behaviour in that case.
// `effectList` powers the pattern picker for WLED / RGBIC strips.
public sealed record LightAttrs(
    [property: JsonPropertyName("brightness")] int? Brightness,
    [property: JsonPropertyName("rgb")] int[]? Rgb,
    [property: JsonPropertyName("colorTemp")] int? ColorTemp,
    [property: JsonPropertyName("minColorTemp")] int? MinColorTemp,
    [property: JsonPropertyName("maxColorTemp")] int? MaxColorTemp,
    [property: JsonPropertyName("effect")] string? Effect,
    [property: JsonPropertyName("effectList")] string[]? EffectList,
    [property: JsonPropertyName("colorMode")] string? ColorMode,
    [property: JsonPropertyName("supportedColorModes")] string[]? SupportedColorModes,
    [property: JsonPropertyName("supportsBrightness")] bool SupportsBrightness,
    [property: JsonPropertyName("supportsColor")] bool SupportsColor,
    [property: JsonPropertyName("supportsColorTemp")] bool SupportsColorTemp,
    [property: JsonPropertyName("supportsEffect")] bool SupportsEffect);

public sealed record HaSample(
    [property: JsonPropertyName("t")] long T,
    [property: JsonPropertyName("v")] double V);

public sealed record HaEntitySummary(
    [property: JsonPropertyName("entityId")] string EntityId,
    [property: JsonPropertyName("domain")] string Domain,
    [property: JsonPropertyName("state")] string? State,
    [property: JsonPropertyName("unit")] string? Unit,
    [property: JsonPropertyName("friendlyName")] string? FriendlyName,
    [property: JsonPropertyName("deviceClass")] string? DeviceClass);
