using System.Text.Json.Serialization;

namespace PzmHomeDashboard.Models;

public sealed class DashboardOptions
{
    [JsonPropertyName("hls_segment_seconds")]
    public int HlsSegmentSeconds { get; set; } = 1;

    [JsonPropertyName("hls_list_size")]
    public int HlsListSize { get; set; } = 5;

    // Re-encode instead of stream-copy: prioritises latency over image
    // quality (forced 1s keyframes, capped width, ultrafast x264). Turn
    // off to get the original untouched camera stream back.
    [JsonPropertyName("low_latency_transcode")]
    public bool LowLatencyTranscode { get; set; } = true;

    // Optional frame-rate cap applied during low-latency transcode. 0 leaves
    // the camera's own rate untouched (default). Lowering it (e.g. 12) trades
    // motion smoothness for noticeably less encode CPU on weak hardware.
    [JsonPropertyName("stream_max_fps")]
    public int StreamMaxFps { get; set; }

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
