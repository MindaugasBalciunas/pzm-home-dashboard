using Microsoft.AspNetCore.Mvc;
using PzmHomeDashboard.Models;
using PzmHomeDashboard.Services;

namespace PzmHomeDashboard.Controllers;

[ApiController]
[Route("api/ha")]
public sealed class HomeAssistantController : ControllerBase
{
    private readonly HomeAssistantClient _client;
    private readonly HomeAssistantOptions _opts;

    public HomeAssistantController(HomeAssistantClient client, HomeAssistantOptions opts)
    {
        _client = client;
        _opts = opts;
    }

    [HttpGet("solar")]
    public async Task<IActionResult> Solar(CancellationToken ct)
    {
        var s = _opts.Solar;
        var pairs = new (string Key, string? EntityId)[]
        {
            ("import",   s.Import),
            ("export",   s.Export),
            ("houseUse", s.HouseUse),
            ("pvTotal",  s.PvTotal),
            ("pv1",      s.Pv1),
            ("pv2",      s.Pv2),
            ("todaySolar",  s.TodaySolar),
            ("todayExport", s.TodayExport),
            ("todayImport", s.TodayImport),
            ("totalSolar",  s.TotalSolar),
            ("solaxTodayImport", s.SolaxTodayImport),
            ("solaxTodayExport", s.SolaxTodayExport),
            ("solaxTodayHouse",  s.SolaxTodayHouse),
            ("pv1Voltage",  s.Pv1Voltage),
            ("pv2Voltage",  s.Pv2Voltage),
            ("pv1Current",  s.Pv1Current),
            ("pv2Current",  s.Pv2Current),
            ("measuredPower", s.MeasuredPower),
            ("runMode",     s.RunMode),
            ("gridRuntime", s.GridRuntime),
            ("batteryPower", s.BatteryPower),
            ("batterySoc",   s.BatterySoc),
            ("p1ImportTotal", s.P1ImportTotal),
            ("p1ExportTotal", s.P1ExportTotal),
        };
        var tasks = pairs
            .Select(async p => (p.Key, State: string.IsNullOrWhiteSpace(p.EntityId)
                ? null
                : await _client.GetStateAsync(p.EntityId!, ct)))
            .ToArray();
        var results = await Task.WhenAll(tasks);
        var payload = new Dictionary<string, object?>();
        foreach (var r in results) payload[r.Key] = r.State;

        // Attach live state for the user-configured electric loads so the
        // Loads section in the Electricity tile can render on/off in the
        // same round-trip.
        var controlTasks = s.Controls.Select(async c => new
        {
            name = c.Name,
            entity = c.Entity,
            icon = c.Icon,
            state = string.IsNullOrWhiteSpace(c.Entity)
                ? null
                : await _client.GetStateAsync(c.Entity, ct),
        }).ToArray();
        payload["controls"] = await Task.WhenAll(controlTasks);

        payload["configured"] = _client.IsConfigured;
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(payload);
    }

    [HttpGet("solar/history")]
    public async Task<IActionResult> SolarHistory(
        [FromQuery] int hours = 24,
        CancellationToken ct = default)
    {
        hours = Math.Clamp(hours, 1, 168);
        var s = _opts.Solar;
        var mapping = new (string Key, string? EntityId)[]
        {
            ("pvTotal",     s.PvTotal),
            ("import",      s.Import),
            ("export",      s.Export),
            ("houseUse",    s.HouseUse),
            ("pv1",         s.Pv1),
            ("pv2",         s.Pv2),
            ("todaySolar",  s.TodaySolar),
            ("todayExport", s.TodayExport),
            ("todayImport", s.TodayImport),
            ("totalSolar",  s.TotalSolar),
        };
        var entityIds = mapping
            .Where(m => !string.IsNullOrWhiteSpace(m.EntityId))
            .Select(m => m.EntityId!)
            .Distinct()
            .ToList();
        var since = DateTime.UtcNow.AddHours(-hours);
        var histories = await _client.GetHistoryAsync(entityIds, since, ct);

        var payload = new Dictionary<string, object?>();
        payload["hours"] = hours;
        foreach (var m in mapping)
        {
            if (string.IsNullOrWhiteSpace(m.EntityId))
            {
                payload[m.Key] = null;
                continue;
            }
            payload[m.Key] = histories.TryGetValue(m.EntityId!, out var samples)
                ? samples
                : null;
        }
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(payload);
    }

    [HttpGet("solar/daily")]
    public async Task<IActionResult> SolarDaily(
        [FromQuery] int days = 7,
        CancellationToken ct = default)
    {
        days = Math.Clamp(days, 1, 30);
        var entity = _opts.Solar.TotalSolar;
        if (string.IsNullOrWhiteSpace(entity))
        {
            return Ok(new { days = Array.Empty<object>() });
        }

        // Ask HA for one extra day at the start so the cumulative-diff
        // fallback has a prior anchor. Statistics bucket boundaries fall
        // on midnight LOCAL, and HA responds with UTC timestamps — the
        // frontend re-labels by local date.
        var start = DateTime.UtcNow.AddDays(-(days + 1));
        var stats = await _client.GetDailyStatisticsAsync(
            new[] { entity! }, start, DateTime.UtcNow, ct);

        if (!stats.TryGetValue(entity!, out var samples) || samples.Count == 0)
        {
            return Ok(new { days = Array.Empty<object>() });
        }

        // Same shape-detection logic as the monthly endpoint: HA may
        // give us per-bucket 'change' deltas already, or a running
        // cumulative sum we need to diff into deltas.
        var values = new List<double>(samples.Count);
        foreach (var s in samples) values.Add(s.V);
        bool looksCumulative = values.Count >= 2 && values[^1] > values[0] * 1.05
                               && values[values.Count - 1] > 10;
        if (looksCumulative)
        {
            var deltas = new List<double>(values.Count);
            deltas.Add(0);
            for (int i = 1; i < values.Count; i++)
            {
                var d = values[i] - values[i - 1];
                deltas.Add(d > 0 ? d : 0);
            }
            values = deltas;
        }

        var result = new List<object>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            var dt = samples[i].T > 0
                ? DateTimeOffset.FromUnixTimeMilliseconds(samples[i].T).UtcDateTime
                : DateTime.UtcNow.AddDays(-(samples.Count - 1 - i));
            result.Add(new
            {
                year = dt.Year,
                month = dt.Month,
                day = dt.Day,
                v = Math.Max(0, values[i]),
            });
        }
        if (result.Count > days)
        {
            result = result.GetRange(result.Count - days, days);
        }

        Response.Headers["Cache-Control"] = "no-store";
        return Ok(new { days = result });
    }

    [HttpGet("solar/monthly")]
    public async Task<IActionResult> SolarMonthly(
        [FromQuery] int months = 12,
        CancellationToken ct = default)
    {
        months = Math.Clamp(months, 1, 24);
        var entity = _opts.Solar.TotalSolar;
        if (string.IsNullOrWhiteSpace(entity))
        {
            return Ok(new { months = Array.Empty<object>() });
        }

        // Long-term statistics from HA's WebSocket recorder API. Include one
        // extra month at the start so we have a prior anchor for delta if we
        // fall back to cumulative-sum diffing.
        var since = DateTime.UtcNow.AddMonths(-(months + 1));
        var stats = await _client.GetMonthlyStatisticsAsync(
            new[] { entity! }, since, DateTime.UtcNow, ct);

        if (!stats.TryGetValue(entity!, out var samples) || samples.Count == 0)
        {
            return Ok(new { months = Array.Empty<object>() });
        }

        // Two shapes are possible from the WebSocket client:
        //   1) samples[i].V is the per-bucket 'change' (already a delta) — use as-is.
        //   2) samples[i].V is the running cumulative 'sum' — compute deltas.
        // Detect (2) by non-decreasing sequence with the last value significantly
        // larger than the first.
        var values = new List<double>(samples.Count);
        foreach (var s in samples) values.Add(s.V);
        bool looksCumulative = values.Count >= 2 && values[^1] > values[0] * 1.2
                               && values[values.Count - 1] > 10;
        if (looksCumulative)
        {
            var deltas = new List<double>(values.Count);
            deltas.Add(0);
            for (int i = 1; i < values.Count; i++)
            {
                var d = values[i] - values[i - 1];
                deltas.Add(d > 0 ? d : 0);
            }
            values = deltas;
        }

        var result = new List<object>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            var dt = samples[i].T > 0
                ? DateTimeOffset.FromUnixTimeMilliseconds(samples[i].T).UtcDateTime
                : DateTime.UtcNow.AddMonths(-(samples.Count - 1 - i));
            result.Add(new
            {
                year = dt.Year,
                month = dt.Month,
                v = Math.Max(0, values[i]),
            });
        }

        if (result.Count > months)
        {
            result = result.GetRange(result.Count - months, months);
        }

        Response.Headers["Cache-Control"] = "no-store";
        return Ok(new { months = result });
    }
}
