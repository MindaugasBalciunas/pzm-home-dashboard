using PzmHomeDashboard.Models;

namespace PzmHomeDashboard.Services;

// Turns HA long-term statistics for an energy sensor into per-bucket kWh.
public static class EnergySeries
{
    // Round a per-bucket energy series to a whole kWh so HA's float noise
    // (e.g. 32.5999…) doesn't leak through to labels. Callers keep this to
    // avoid cumulative float error drifting the monthly/daily figures.
    public static double Sanitize(double v) => v > 0 && v < 0.05 ? 0 : v;

    // HA's long-term statistics for a cumulative total-energy meter give
    // three views of the same counter, and they disagree:
    //   * 'state'  — the raw absolute reading (e.g. the Solax inverter's
    //     lifetime total, ~20 MWh). Reliable and monotonic; survives plug-ins
    //     re-registering the statistics.
    //   * 'change' — the per-bucket delta. Correct in clean regions, but HA
    //     derives it from 'sum', which can be reset/re-registered mid-window,
    //     producing a bogus download spike (July "change" came back ≈ the
    //     whole 40 MWh lifetime while June was a sane 1204 kWh).
    //   * 'sum'    — the running total; also resets.
    // So for a meter-shaped series we diff the absolute 'state' counter.
    //
    // Because 'state' is a running total, the series is large, near-monotonic
    // and creeps up only a few % per bucket — unlike a genuine per-month/per-
    // day delta series, which swings down toward zero and spans many ×.
    public static bool LooksLikeCumulativeMeter(IReadOnlyList<double> values)
    {
        if (values.Count < 2) return false;
        double mn = double.MaxValue, mx = double.MinValue;
        foreach (var v in values)
        {
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        // A meter's absolute reading sits comfortably above zero.
        if (mn < 10 || mx < 10) return false;
        // A lifetime total creeps <50% over the sampled window; a per-bucket
        // energy series (seasonal solar, daily output) spans far more.
        if (mx > mn * 1.5) return false;
        // A meter never resets or drops sharply between buckets.
        for (int i = 1; i < values.Count; i++)
        {
            if (values[i] < values[i - 1] - 1) return false;
        }
        return true;
    }

    // Consecutive-difference series for a cumulative meter, first bucket
    // treated as an anchor (0). Falls back to per-bucket 'change' (already a
    // delta) when the series isn't meter-shaped.
    public static List<double> PerBucketEnergy(IReadOnlyList<HaSample> samples)
    {
        var stateSeries = samples.Select(s => s.State ?? s.V).ToList();
        if (!LooksLikeCumulativeMeter(stateSeries)) return samples.Select(s => s.V).ToList();

        var deltas = new List<double>(samples.Count) { 0 };
        for (int i = 1; i < samples.Count; i++)
        {
            var d = stateSeries[i] - stateSeries[i - 1];
            deltas.Add(d > 0 ? Sanitize(d) : 0);
        }
        return deltas;
    }
}
