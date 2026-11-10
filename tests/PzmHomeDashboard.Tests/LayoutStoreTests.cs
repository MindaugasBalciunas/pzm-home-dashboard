using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using PzmHomeDashboard.Services;
using Xunit;

namespace PzmHomeDashboard.Tests;

public sealed class LayoutStoreTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("pzm-layout-").FullName;
    private string LayoutPath => Path.Combine(_dir, "layout.json");

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private LayoutStore Open() => new(NullLogger<LayoutStore>.Instance, LayoutPath);

    private static JsonElement Layout(string marker)
    {
        using var doc = JsonDocument.Parse($$"""{"marker":"{{marker}}"}""");
        return doc.RootElement.Clone();
    }

    private static string Marker(LayoutStore store) => store.Get().Layout.GetProperty("marker").GetString()!;

    [Fact]
    public void Missing_file_starts_as_an_empty_layout()
    {
        using var store = Open();
        Assert.Equal(0, store.Get().Revision);
        Assert.Equal(JsonValueKind.Object, store.Get().Layout.ValueKind);
    }

    [Fact]
    public async Task Pending_write_is_flushed_on_dispose_and_survives_a_restart()
    {
        using (var store = Open())
        {
            await store.SetAsync(Layout("A"), CancellationToken.None);
            // Still inside the debounce window: nothing on disk yet.
            Assert.False(File.Exists(LayoutPath));
        }

        Assert.True(File.Exists(LayoutPath));
        Assert.False(File.Exists(LayoutPath + ".tmp"));
        using var reopened = Open();
        Assert.Equal(1, reopened.Get().Revision);
        Assert.Equal("A", Marker(reopened));
    }

    [Fact]
    public async Task Previous_copy_is_kept_as_backup()
    {
        using (var store = Open()) await store.SetAsync(Layout("A"), CancellationToken.None);
        using (var store = Open()) await store.SetAsync(Layout("B"), CancellationToken.None);

        Assert.Contains("\"B\"", File.ReadAllText(LayoutPath));
        Assert.Contains("\"A\"", File.ReadAllText(LayoutPath + ".bak"));
    }

    [Theory]
    [InlineData("{\"revision\":2,\"layout\":{\"mar")] // truncated by a power cut
    [InlineData("")]
    [InlineData("{\"revision\":2,\"layout\":null}")]
    public async Task Unreadable_live_file_falls_back_to_the_backup(string corrupt)
    {
        using (var store = Open()) await store.SetAsync(Layout("A"), CancellationToken.None);
        using (var store = Open()) await store.SetAsync(Layout("B"), CancellationToken.None);
        File.WriteAllText(LayoutPath, corrupt);

        using var reopened = Open();
        Assert.Equal("A", Marker(reopened));
    }

    [Fact]
    public async Task Subscribers_receive_new_snapshots()
    {
        using var store = Open();
        var ch = store.Subscribe();
        await store.SetAsync(Layout("A"), CancellationToken.None);

        Assert.True(ch.Reader.TryRead(out var snap));
        Assert.Equal(1, snap!.Revision);
        store.Unsubscribe(ch);
    }
}
