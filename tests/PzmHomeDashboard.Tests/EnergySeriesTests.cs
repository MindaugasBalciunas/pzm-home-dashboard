using PzmHomeDashboard.Models;
using PzmHomeDashboard.Services;
using Xunit;

namespace PzmHomeDashboard.Tests;

public class EnergySeriesTests
{
    private static List<HaSample> Samples(params (double change, double? state)[] rows)
        => rows.Select((r, i) => new HaSample(i + 1, r.change, r.state)).ToList();

    [Fact]
    public void Lifetime_meter_is_diffed_from_its_absolute_reading()
    {
        // 'change' carries the bogus spike HA produces when the statistic is
        // re-registered; the absolute 'state' counter is what gets trusted.
        var values = EnergySeries.PerBucketEnergy(Samples(
            (5, 20000), (40000, 20012.5), (9, 20020), (11, 20031)));

        Assert.Equal(new[] { 0, 12.5, 7.5, 11 }, values);
    }

    [Fact]
    public void Per_bucket_delta_series_is_used_as_is()
    {
        // Seasonal monthly output swings far more than 50% — not a meter.
        var values = EnergySeries.PerBucketEnergy(Samples(
            (1204, 1204), (300, 300), (80, 80)));

        Assert.Equal(new[] { 1204d, 300, 80 }, values);
    }

    [Fact]
    public void Series_without_state_falls_back_to_change()
    {
        var values = EnergySeries.PerBucketEnergy(Samples((3, null), (4, null)));
        Assert.Equal(new[] { 3d, 4 }, values);
    }

    [Theory]
    [InlineData(new[] { 20000d, 20010, 20025 }, true)]
    [InlineData(new[] { 20000d }, false)]             // too short to judge
    [InlineData(new[] { 2d, 3, 4 }, false)]           // too small for a lifetime total
    [InlineData(new[] { 100d, 400, 900 }, false)]     // grows too fast
    [InlineData(new[] { 20000d, 19000, 20025 }, false)] // a meter never drops
    public void Meter_shape_detection(double[] values, bool expected)
        => Assert.Equal(expected, EnergySeries.LooksLikeCumulativeMeter(values));

    [Fact]
    public void Meter_dip_within_a_bucket_never_goes_negative()
    {
        var values = EnergySeries.PerBucketEnergy(Samples((0, 20000), (0, 19999.5), (0, 20010)));
        Assert.All(values, v => Assert.True(v >= 0));
    }

    [Theory]
    [InlineData(0.01, 0)]
    [InlineData(0.05, 0.05)]
    [InlineData(7.5, 7.5)]
    [InlineData(-1, -1)]
    public void Sanitize_drops_float_noise_only(double input, double expected)
        => Assert.Equal(expected, EnergySeries.Sanitize(input));
}
