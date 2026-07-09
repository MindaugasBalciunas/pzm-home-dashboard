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
}

public sealed record HaStateDto(
    [property: JsonPropertyName("entityId")] string EntityId,
    [property: JsonPropertyName("state")] string? State,
    [property: JsonPropertyName("unit")] string? Unit,
    [property: JsonPropertyName("friendlyName")] string? FriendlyName);

public sealed record HaSample(
    [property: JsonPropertyName("t")] long T,
    [property: JsonPropertyName("v")] double V);
