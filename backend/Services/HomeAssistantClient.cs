using System.Globalization;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using PzmHomeDashboard.Models;

namespace PzmHomeDashboard.Services;

public sealed class HomeAssistantClient
{
    private readonly IHttpClientFactory _factory;
    private readonly HomeAssistantOptions _opts;
    private readonly ILogger<HomeAssistantClient> _log;

    public HomeAssistantClient(IHttpClientFactory factory, HomeAssistantOptions opts, ILogger<HomeAssistantClient> log)
    {
        _factory = factory;
        _opts = opts;
        _log = log;
    }

    public bool IsConfigured
    {
        get
        {
            var (baseUrl, token) = ResolveCreds();
            return !string.IsNullOrWhiteSpace(baseUrl) && !string.IsNullOrWhiteSpace(token);
        }
    }

    public async Task<HaStateDto?> GetStateAsync(string entityId, CancellationToken ct)
    {
        var (baseUrl, token) = ResolveCreds();
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token))
        {
            return new HaStateDto(entityId, null, null, null);
        }

        var http = _factory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(5);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var url = baseUrl + "states/" + entityId;
        try
        {
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _log.LogDebug("HA {Entity} -> HTTP {Code}", entityId, (int)resp.StatusCode);
                return new HaStateDto(entityId, null, null, null);
            }
            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            var raw = await JsonSerializer.DeserializeAsync<HaStateJson>(stream, cancellationToken: ct);
            if (raw is null) return new HaStateDto(entityId, null, null, null);

            string? unit = null;
            string? friendly = null;
            if (raw.Attributes is { } attrs)
            {
                if (attrs.TryGetValue("unit_of_measurement", out var u) && u.ValueKind == JsonValueKind.String) unit = u.GetString();
                if (attrs.TryGetValue("friendly_name", out var f) && f.ValueKind == JsonValueKind.String) friendly = f.GetString();
            }
            return new HaStateDto(entityId, raw.State, unit, friendly);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "HA fetch failed for {Entity}", entityId);
            return new HaStateDto(entityId, null, null, null);
        }
    }

    public async Task<Dictionary<string, IReadOnlyList<HaSample>>> GetHistoryAsync(
        IReadOnlyList<string> entityIds, DateTime since, CancellationToken ct)
    {
        var result = new Dictionary<string, IReadOnlyList<HaSample>>();
        if (entityIds.Count == 0) return result;

        var (baseUrl, token) = ResolveCreds();
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token)) return result;

        var http = _factory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(15);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var sinceIso = since.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
        var filter = string.Join(",", entityIds);
        var url = baseUrl + "history/period/" + sinceIso
            + "?filter_entity_id=" + Uri.EscapeDataString(filter)
            + "&minimal_response";

        try
        {
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _log.LogDebug("HA history -> HTTP {Code}", (int)resp.StatusCode);
                return result;
            }
            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return result;

            foreach (var group in doc.RootElement.EnumerateArray())
            {
                if (group.ValueKind != JsonValueKind.Array) continue;
                var samples = new List<HaSample>();
                string? entityId = null;
                foreach (var item in group.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) continue;
                    if (entityId == null
                        && item.TryGetProperty("entity_id", out var eid)
                        && eid.ValueKind == JsonValueKind.String)
                    {
                        entityId = eid.GetString();
                    }
                    if (!item.TryGetProperty("state", out var st)) continue;
                    if (!item.TryGetProperty("last_changed", out var lc)) continue;
                    if (st.ValueKind != JsonValueKind.String) continue;
                    if (!double.TryParse(st.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var v)) continue;
                    if (lc.ValueKind != JsonValueKind.String) continue;
                    if (!DateTime.TryParse(
                        lc.GetString(),
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.RoundtripKind,
                        out var t)) continue;
                    samples.Add(new HaSample(
                        new DateTimeOffset(t.ToUniversalTime()).ToUnixTimeMilliseconds(),
                        v));
                }
                if (entityId != null)
                {
                    result[entityId] = Downsample(samples, 200);
                }
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "HA history fetch failed");
        }
        return result;

        static List<HaSample> Downsample(List<HaSample> src, int maxPoints)
        {
            if (src.Count <= maxPoints) return src;
            var outList = new List<HaSample>(maxPoints);
            for (int i = 0; i < maxPoints; i++)
            {
                var idx = (int)((long)i * src.Count / maxPoints);
                outList.Add(src[idx]);
            }
            return outList;
        }
    }

    // Long-term statistics come from HA's Statistics table (indefinite retention),
    // which is only accessible via the WebSocket API, not the REST /history endpoint.
    public async Task<Dictionary<string, IReadOnlyList<HaSample>>> GetMonthlyStatisticsAsync(
        IReadOnlyList<string> entityIds, DateTime startTime, DateTime endTime, CancellationToken ct)
    {
        var result = new Dictionary<string, IReadOnlyList<HaSample>>();
        if (entityIds.Count == 0) return result;

        var (baseUrl, token) = ResolveCreds();
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token)) return result;

        // Build ws:// URL from the REST base URL.
        Uri restUri;
        try { restUri = new Uri(baseUrl); }
        catch { return result; }
        var wsScheme = restUri.Scheme == "https" ? "wss" : "ws";
        var portPart = restUri.IsDefaultPort ? "" : $":{restUri.Port}";
        var wsUri = new Uri($"{wsScheme}://{restUri.Host}{portPart}/api/websocket");

        using var ws = new ClientWebSocket();
        try
        {
            using var connectCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            connectCts.CancelAfter(TimeSpan.FromSeconds(10));
            await ws.ConnectAsync(wsUri, connectCts.Token);

            // Expect auth_required frame first.
            var greeting = await ReceiveJsonAsync(ws, ct);
            if (greeting is null) return result;

            // Authenticate.
            var authMsg = JsonSerializer.Serialize(new
            {
                type = "auth",
                access_token = token!,
            });
            await SendAsync(ws, authMsg, ct);

            var authResp = await ReceiveJsonAsync(ws, ct);
            if (authResp is null
                || !authResp.Value.TryGetProperty("type", out var authType)
                || authType.GetString() != "auth_ok")
            {
                _log.LogWarning("HA WebSocket auth failed.");
                return result;
            }

            // Request statistics — month buckets, change field.
            var reqMsg = JsonSerializer.Serialize(new
            {
                id = 1,
                type = "recorder/statistics_during_period",
                start_time = startTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssK", CultureInfo.InvariantCulture),
                end_time   = endTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssK", CultureInfo.InvariantCulture),
                statistic_ids = entityIds,
                period = "month",
                types = new[] { "sum", "state", "change" },
            });
            await SendAsync(ws, reqMsg, ct);

            var resp = await ReceiveJsonAsync(ws, ct);
            if (resp is null) return result;
            var respRoot = resp.Value;

            if (!respRoot.TryGetProperty("success", out var success) || !success.GetBoolean())
            {
                _log.LogDebug("HA statistics call returned success=false");
                return result;
            }
            if (!respRoot.TryGetProperty("result", out var resultEl) || resultEl.ValueKind != JsonValueKind.Object)
            {
                return result;
            }

            foreach (var entityId in entityIds)
            {
                if (!resultEl.TryGetProperty(entityId, out var arr) || arr.ValueKind != JsonValueKind.Array)
                    continue;

                var samples = new List<HaSample>();
                foreach (var item in arr.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) continue;
                    // Prefer explicit 'change' when present (kWh delta over the bucket).
                    double? value = null;
                    if (item.TryGetProperty("change", out var changeEl) && changeEl.ValueKind == JsonValueKind.Number)
                    {
                        value = changeEl.GetDouble();
                    }
                    else if (item.TryGetProperty("sum", out var sumEl) && sumEl.ValueKind == JsonValueKind.Number)
                    {
                        // Fall back to cumulative sum — controller will diff consecutive months.
                        value = sumEl.GetDouble();
                    }
                    else if (item.TryGetProperty("state", out var stateEl) && stateEl.ValueKind == JsonValueKind.Number)
                    {
                        value = stateEl.GetDouble();
                    }
                    if (value is null) continue;

                    long ts = 0;
                    if (item.TryGetProperty("start", out var startEl))
                    {
                        if (startEl.ValueKind == JsonValueKind.String
                            && DateTime.TryParse(startEl.GetString(), CultureInfo.InvariantCulture,
                                DateTimeStyles.RoundtripKind, out var dt))
                        {
                            ts = new DateTimeOffset(dt.ToUniversalTime()).ToUnixTimeMilliseconds();
                        }
                        else if (startEl.ValueKind == JsonValueKind.Number)
                        {
                            // Some HA versions serialize as ms epoch.
                            ts = startEl.GetInt64();
                        }
                    }
                    samples.Add(new HaSample(ts, value.Value));
                }
                result[entityId] = samples;
            }

            try
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch { /* best-effort */ }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "HA WebSocket statistics failed");
        }

        return result;
    }

    private static async Task SendAsync(ClientWebSocket ws, string message, CancellationToken ct)
    {
        var buffer = Encoding.UTF8.GetBytes(message);
        await ws.SendAsync(new ArraySegment<byte>(buffer), WebSocketMessageType.Text, true, ct);
    }

    private static async Task<JsonElement?> ReceiveJsonAsync(ClientWebSocket ws, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        var buffer = new byte[8192];
        WebSocketReceiveResult res;
        do
        {
            res = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
            if (res.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, res.Count);
        } while (!res.EndOfMessage);
        ms.Position = 0;
        try
        {
            using var doc = await JsonDocument.ParseAsync(ms, cancellationToken: ct);
            return doc.RootElement.Clone();
        }
        catch { return null; }
    }

    private (string? baseUrl, string? token) ResolveCreds()
    {
        var supToken = Environment.GetEnvironmentVariable("SUPERVISOR_TOKEN");
        if (_opts.UseSupervisor || !string.IsNullOrEmpty(supToken))
        {
            return ("http://supervisor/core/api/", supToken);
        }
        var url = _opts.BaseUrl?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(url)) return (null, _opts.Token);
        if (!url.EndsWith("/api", StringComparison.OrdinalIgnoreCase)) url += "/api";
        return (url + "/", _opts.Token);
    }

    private sealed class HaStateJson
    {
        [JsonPropertyName("entity_id")] public string? EntityId { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
        [JsonPropertyName("attributes")] public Dictionary<string, JsonElement>? Attributes { get; set; }
    }
}
