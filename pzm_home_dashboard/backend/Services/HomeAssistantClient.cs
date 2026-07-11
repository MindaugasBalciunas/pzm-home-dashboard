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

    public async Task<IReadOnlyList<HaEntitySummary>> GetAllStatesAsync(CancellationToken ct)
    {
        var (baseUrl, token) = ResolveCreds();
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token))
            return Array.Empty<HaEntitySummary>();

        var http = _factory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(10);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            using var resp = await http.GetAsync(baseUrl + "states", ct);
            if (!resp.IsSuccessStatusCode) return Array.Empty<HaEntitySummary>();
            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return Array.Empty<HaEntitySummary>();

            var list = new List<HaEntitySummary>();
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                if (!item.TryGetProperty("entity_id", out var eid)
                    || eid.ValueKind != JsonValueKind.String) continue;
                var entityId = eid.GetString();
                if (string.IsNullOrEmpty(entityId)) continue;
                var dot = entityId.IndexOf('.');
                if (dot <= 0) continue;
                var domain = entityId[..dot];

                string? state = null;
                if (item.TryGetProperty("state", out var st) && st.ValueKind == JsonValueKind.String)
                    state = st.GetString();

                string? unit = null, friendly = null, deviceClass = null;
                if (item.TryGetProperty("attributes", out var attrs)
                    && attrs.ValueKind == JsonValueKind.Object)
                {
                    if (attrs.TryGetProperty("unit_of_measurement", out var u)
                        && u.ValueKind == JsonValueKind.String) unit = u.GetString();
                    if (attrs.TryGetProperty("friendly_name", out var f)
                        && f.ValueKind == JsonValueKind.String) friendly = f.GetString();
                    if (attrs.TryGetProperty("device_class", out var d)
                        && d.ValueKind == JsonValueKind.String) deviceClass = d.GetString();
                }
                list.Add(new HaEntitySummary(entityId, domain, state, unit, friendly, deviceClass));
            }
            return list;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "HA getAllStates failed");
            return Array.Empty<HaEntitySummary>();
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
            LightAttrs? light = null;
            if (raw.Attributes is { } attrs)
            {
                if (attrs.TryGetValue("unit_of_measurement", out var u) && u.ValueKind == JsonValueKind.String) unit = u.GetString();
                if (attrs.TryGetValue("friendly_name", out var f) && f.ValueKind == JsonValueKind.String) friendly = f.GetString();
                if (entityId.StartsWith("light.", StringComparison.OrdinalIgnoreCase))
                {
                    light = ExtractLightAttrs(attrs);
                }
            }
            return new HaStateDto(entityId, raw.State, unit, friendly, light);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "HA fetch failed for {Entity}", entityId);
            return new HaStateDto(entityId, null, null, null);
        }
    }

    // Select-domain entities (e.g. the TrackMix PTZ preset select) carry
    // their choices in attributes.options; the generic state DTO drops
    // attributes, so the PTZ card gets this dedicated fetch.
    public async Task<HaSelectDto> GetSelectAsync(string entityId, CancellationToken ct)
    {
        var empty = new HaSelectDto(entityId, null, Array.Empty<string>(), null);
        var (baseUrl, token) = ResolveCreds();
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token)) return empty;

        var http = _factory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(5);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            using var resp = await http.GetAsync(baseUrl + "states/" + entityId, ct);
            if (!resp.IsSuccessStatusCode) return empty;
            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            var raw = await JsonSerializer.DeserializeAsync<HaStateJson>(stream, cancellationToken: ct);
            if (raw is null) return empty;

            string? friendly = null;
            var options = new List<string>();
            if (raw.Attributes is { } attrs)
            {
                if (attrs.TryGetValue("friendly_name", out var f) && f.ValueKind == JsonValueKind.String)
                    friendly = f.GetString();
                if (attrs.TryGetValue("options", out var opts) && opts.ValueKind == JsonValueKind.Array)
                {
                    foreach (var el in opts.EnumerateArray())
                    {
                        if (el.ValueKind != JsonValueKind.String) continue;
                        var s = el.GetString();
                        if (!string.IsNullOrWhiteSpace(s)) options.Add(s!);
                    }
                }
            }
            return new HaSelectDto(entityId, raw.State, options, friendly);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "HA select fetch failed for {Entity}", entityId);
            return empty;
        }
    }

    // Pull the small set of light-domain attributes the frontend cares
    // about (dim slider + colour picker). `supported_color_modes` /
    // `supported_features` tell us which controls to render — a plain
    // on/off bulb reports neither. Home Assistant sends brightness as
    // 0-255; keep it that way and let the UI scale.
    private static LightAttrs ExtractLightAttrs(Dictionary<string, JsonElement> attrs)
    {
        int? brightness = null;
        if (attrs.TryGetValue("brightness", out var b) && b.ValueKind == JsonValueKind.Number)
        {
            brightness = b.TryGetInt32(out var bi) ? bi : (int)b.GetDouble();
        }

        int[]? rgb = null;
        if (attrs.TryGetValue("rgb_color", out var rc) && rc.ValueKind == JsonValueKind.Array)
        {
            var list = new List<int>(3);
            foreach (var el in rc.EnumerateArray())
            {
                if (el.ValueKind == JsonValueKind.Number)
                    list.Add(el.TryGetInt32(out var i) ? i : (int)el.GetDouble());
            }
            if (list.Count >= 3) rgb = new[] { list[0], list[1], list[2] };
        }

        int? colorTemp = TryReadInt(attrs, "color_temp_kelvin")
                         ?? TryReadInt(attrs, "color_temp");
        int? minColorTemp = TryReadInt(attrs, "min_color_temp_kelvin")
                            ?? TryReadInt(attrs, "min_mireds");
        int? maxColorTemp = TryReadInt(attrs, "max_color_temp_kelvin")
                            ?? TryReadInt(attrs, "max_mireds");

        var modes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (attrs.TryGetValue("supported_color_modes", out var scm)
            && scm.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in scm.EnumerateArray())
                if (el.ValueKind == JsonValueKind.String)
                    modes.Add(el.GetString() ?? "");
        }
        var currentMode = attrs.TryGetValue("color_mode", out var cm)
            && cm.ValueKind == JsonValueKind.String ? cm.GetString() : null;

        string[]? effectList = null;
        if (attrs.TryGetValue("effect_list", out var elArr)
            && elArr.ValueKind == JsonValueKind.Array)
        {
            var list = new List<string>();
            foreach (var el in elArr.EnumerateArray())
            {
                if (el.ValueKind == JsonValueKind.String)
                {
                    var s = el.GetString();
                    if (!string.IsNullOrWhiteSpace(s)) list.Add(s);
                }
            }
            if (list.Count > 0) effectList = list.ToArray();
        }

        var currentEffect = attrs.TryGetValue("effect", out var eff)
            && eff.ValueKind == JsonValueKind.String ? eff.GetString() : null;

        // HA convention: SUPPORT_EFFECT = 4 inside `supported_features`.
        int? supportedFeatures = TryReadInt(attrs, "supported_features");
        bool featureFlagEffect = supportedFeatures.HasValue && (supportedFeatures.Value & 4) != 0;

        bool colorish(string m) =>
            m.Equals("rgb", StringComparison.OrdinalIgnoreCase)
            || m.Equals("rgbw", StringComparison.OrdinalIgnoreCase)
            || m.Equals("rgbww", StringComparison.OrdinalIgnoreCase)
            || m.Equals("hs", StringComparison.OrdinalIgnoreCase)
            || m.Equals("xy", StringComparison.OrdinalIgnoreCase);

        bool supportsBrightness = modes.Any(m => !m.Equals("onoff", StringComparison.OrdinalIgnoreCase))
                                  || brightness != null;
        bool supportsColor = modes.Any(colorish) || rgb != null;
        bool supportsColorTemp = modes.Contains("color_temp")
                                 || (currentMode != null && currentMode.Equals("color_temp", StringComparison.OrdinalIgnoreCase))
                                 || colorTemp != null;
        bool supportsEffect = (effectList != null && effectList.Length > 0) || featureFlagEffect;

        var modesArray = modes.Count > 0 ? modes.ToArray() : null;

        return new LightAttrs(
            brightness, rgb, colorTemp, minColorTemp, maxColorTemp,
            currentEffect, effectList,
            currentMode, modesArray,
            supportsBrightness, supportsColor, supportsColorTemp, supportsEffect);
    }

    private static int? TryReadInt(Dictionary<string, JsonElement> attrs, string key)
    {
        if (!attrs.TryGetValue(key, out var el) || el.ValueKind != JsonValueKind.Number) return null;
        return el.TryGetInt32(out var i) ? i : (int)el.GetDouble();
    }

    // Fire a HA service call. `data` becomes the JSON body; entity_id is
    // conventionally included there. Returns true on 2xx.
    public async Task<bool> CallServiceAsync(
        string domain, string service, object? data, CancellationToken ct)
    {
        var (baseUrl, token) = ResolveCreds();
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token))
        {
            _log.LogWarning("HA service call skipped: not configured.");
            return false;
        }

        var http = _factory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(8);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var url = baseUrl + "services/" + domain + "/" + service;
        var json = data is null ? "{}" : JsonSerializer.Serialize(data);
        using var body = new StringContent(json, Encoding.UTF8, "application/json");
        try
        {
            using var resp = await http.PostAsync(url, body, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var text = await resp.Content.ReadAsStringAsync(ct);
                _log.LogWarning("HA service {Domain}.{Service} -> HTTP {Code}: {Body}",
                    domain, service, (int)resp.StatusCode, text);
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "HA service {Domain}.{Service} failed", domain, service);
            return false;
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
    public Task<Dictionary<string, IReadOnlyList<HaSample>>> GetMonthlyStatisticsAsync(
        IReadOnlyList<string> entityIds, DateTime startTime, DateTime endTime, CancellationToken ct)
        => GetStatisticsAsync(entityIds, startTime, endTime, "month", ct);

    public Task<Dictionary<string, IReadOnlyList<HaSample>>> GetDailyStatisticsAsync(
        IReadOnlyList<string> entityIds, DateTime startTime, DateTime endTime, CancellationToken ct)
        => GetStatisticsAsync(entityIds, startTime, endTime, "day", ct);

    public async Task<Dictionary<string, IReadOnlyList<HaSample>>> GetStatisticsAsync(
        IReadOnlyList<string> entityIds, DateTime startTime, DateTime endTime, string period, CancellationToken ct)
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

            // Request statistics — bucket per requested period; ask HA for
            // sum / state / change so the delta path in the caller works.
            var reqMsg = JsonSerializer.Serialize(new
            {
                id = 1,
                type = "recorder/statistics_during_period",
                start_time = startTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssK", CultureInfo.InvariantCulture),
                end_time   = endTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssK", CultureInfo.InvariantCulture),
                statistic_ids = entityIds,
                period,
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
