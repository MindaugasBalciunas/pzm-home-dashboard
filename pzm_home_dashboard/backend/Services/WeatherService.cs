using System.Text.Json;

namespace PzmHomeDashboard.Services;

// Hourly forecast for the weather card, fetched from Open-Meteo (keyless)
// for Home Assistant's home coordinates. The upstream response is cached
// for 15 minutes — hourly forecasts don't move faster, and every kiosk
// poll must not become an external API call.
public sealed class WeatherService
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(15);

    private readonly IHttpClientFactory _factory;
    private readonly HomeAssistantClient _ha;
    private readonly ILogger<WeatherService> _log;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private (double Lat, double Lon)? _coords;
    private JsonElement? _cachedRaw;
    private DateTimeOffset _cachedAt = DateTimeOffset.MinValue;

    public WeatherService(IHttpClientFactory factory, HomeAssistantClient ha, ILogger<WeatherService> log)
    {
        _factory = factory;
        _ha = ha;
        _log = log;
    }

    // Payload for the frontend: the next 24 hourly slots from "now" plus
    // the sunrise/sunset events that fall inside that window. All times
    // are unix seconds so the browser renders them in its own timezone.
    public async Task<object> GetForecastAsync(CancellationToken ct)
    {
        var raw = await GetRawAsync(ct);
        if (raw is null)
        {
            return new { configured = _ha.IsConfigured, hours = Array.Empty<object>(), sun = Array.Empty<object>() };
        }

        var root = raw.Value;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var hours = new List<object>(24);
        long windowEnd = now;

        if (root.TryGetProperty("hourly", out var hourly)
            && hourly.TryGetProperty("time", out var times)
            && times.ValueKind == JsonValueKind.Array)
        {
            double At(string key, int i)
            {
                if (hourly.TryGetProperty(key, out var arr)
                    && arr.ValueKind == JsonValueKind.Array
                    && i < arr.GetArrayLength()
                    && arr[i].ValueKind == JsonValueKind.Number)
                {
                    return arr[i].GetDouble();
                }
                return double.NaN;
            }

            var n = times.GetArrayLength();
            for (var i = 0; i < n && hours.Count < 24; i++)
            {
                if (times[i].ValueKind != JsonValueKind.Number) continue;
                var t = times[i].GetInt64();
                // Keep the slot covering the current hour too.
                if (t < now - 3600) continue;
                hours.Add(new
                {
                    t,
                    temp = At("temperature_2m", i),
                    code = (int)At("weather_code", i),
                    wind = At("wind_speed_10m", i),
                    windDir = At("wind_direction_10m", i),
                    precip = At("precipitation_probability", i),
                });
                if (t > windowEnd) windowEnd = t;
            }
        }

        var sun = new List<object>();
        if (root.TryGetProperty("daily", out var daily))
        {
            void AddSunEvents(string key, string type)
            {
                if (!daily.TryGetProperty(key, out var arr) || arr.ValueKind != JsonValueKind.Array) return;
                foreach (var el in arr.EnumerateArray())
                {
                    if (el.ValueKind != JsonValueKind.Number) continue;
                    var t = el.GetInt64();
                    // Include the day's events slightly behind "now" so the
                    // frontend can tell day from night at the strip start.
                    if (t >= now - 24 * 3600 && t <= windowEnd + 3600)
                        sun.Add(new { t, type });
                }
            }
            AddSunEvents("sunrise", "sunrise");
            AddSunEvents("sunset", "sunset");
        }

        return new { configured = _ha.IsConfigured, hours, sun };
    }

    private async Task<JsonElement?> GetRawAsync(CancellationToken ct)
    {
        if (_cachedRaw is not null && DateTimeOffset.UtcNow - _cachedAt < CacheFor) return _cachedRaw;

        await _lock.WaitAsync(ct);
        try
        {
            if (_cachedRaw is not null && DateTimeOffset.UtcNow - _cachedAt < CacheFor) return _cachedRaw;

            // Home doesn't move — resolve the coordinates once and keep them.
            _coords ??= await _ha.GetHomeCoordinatesAsync(ct);
            if (_coords is null) return null;

            var (lat, lon) = _coords.Value;
            var url = "https://api.open-meteo.com/v1/forecast"
                + $"?latitude={lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}"
                + $"&longitude={lon.ToString(System.Globalization.CultureInfo.InvariantCulture)}"
                + "&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m"
                + "&daily=sunrise,sunset"
                + "&forecast_days=3&timezone=auto&timeformat=unixtime&wind_speed_unit=ms";

            var http = _factory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(10);
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _log.LogWarning("Open-Meteo -> HTTP {Code}", (int)resp.StatusCode);
                return _cachedRaw; // stale beats nothing
            }
            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            _cachedRaw = doc.RootElement.Clone();
            _cachedAt = DateTimeOffset.UtcNow;
            return _cachedRaw;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Open-Meteo fetch failed");
            return _cachedRaw;
        }
        finally
        {
            _lock.Release();
        }
    }
}
