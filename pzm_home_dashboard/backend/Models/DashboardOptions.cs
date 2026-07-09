using System.Text.Json.Serialization;

namespace PzmHomeDashboard.Models;

public sealed class DashboardOptions
{
    [JsonPropertyName("hls_segment_seconds")]
    public int HlsSegmentSeconds { get; set; } = 2;

    [JsonPropertyName("hls_list_size")]
    public int HlsListSize { get; set; } = 5;

    [JsonPropertyName("idle_shutdown_seconds")]
    public int IdleShutdownSeconds { get; set; } = 30;

    [JsonPropertyName("cameras")]
    public List<CameraOptions> Cameras { get; set; } = new();

    [JsonPropertyName("home_assistant")]
    public HomeAssistantOptions HomeAssistant { get; set; } = new();
}

public sealed class CameraOptions
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("url")]
    public string Url { get; set; } = "";

    [JsonPropertyName("username")]
    public string? Username { get; set; }

    [JsonPropertyName("password")]
    public string? Password { get; set; }

    [JsonPropertyName("transport")]
    public string Transport { get; set; } = "tcp";
}

public sealed record CameraDto(string Id, string Name);
