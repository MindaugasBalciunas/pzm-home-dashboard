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
