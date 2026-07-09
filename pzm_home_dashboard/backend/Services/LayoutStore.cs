using System.Text.Json;
using System.Threading.Channels;

namespace PzmHomeDashboard.Services;

// Shared dashboard layout persisted to disk. In HAOS the /data directory is
// the addon-scoped persistent volume; locally it falls back to the app dir so
// dev picks up your saved layout across restarts.
public sealed class LayoutStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly ILogger<LayoutStore> _log;
    private readonly List<Channel<LayoutSnapshot>> _subscribers = new();
    private readonly object _subLock = new();
    private long _revision;
    private JsonElement _current;

    public LayoutStore(ILogger<LayoutStore> log)
    {
        _log = log;
        _path = ResolvePath();
        Load();
    }

    public LayoutSnapshot Get() => new(_revision, _current);

    public async Task<LayoutSnapshot> SetAsync(JsonElement layout, CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        try
        {
            _revision++;
            _current = layout.Clone();
            var json = JsonSerializer.Serialize(new { revision = _revision, layout = _current });
            try
            {
                var dir = Path.GetDirectoryName(_path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);
                await File.WriteAllTextAsync(_path, json, ct);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Failed to persist layout to {Path}", _path);
            }
        }
        finally { _lock.Release(); }

        var snap = new LayoutSnapshot(_revision, _current);
        Broadcast(snap);
        return snap;
    }

    public Channel<LayoutSnapshot> Subscribe()
    {
        var ch = Channel.CreateBounded<LayoutSnapshot>(new BoundedChannelOptions(4)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });
        lock (_subLock) _subscribers.Add(ch);
        return ch;
    }

    public void Unsubscribe(Channel<LayoutSnapshot> ch)
    {
        lock (_subLock) _subscribers.Remove(ch);
        ch.Writer.TryComplete();
    }

    private void Broadcast(LayoutSnapshot snap)
    {
        Channel<LayoutSnapshot>[] copies;
        lock (_subLock) copies = _subscribers.ToArray();
        foreach (var c in copies) c.Writer.TryWrite(snap);
    }

    private static string ResolvePath()
    {
        var env = Environment.GetEnvironmentVariable("PZM_LAYOUT_PATH");
        if (!string.IsNullOrWhiteSpace(env)) return env;
        if (Directory.Exists("/data")) return "/data/layout.json";
        return Path.Combine(AppContext.BaseDirectory, "layout.json");
    }

    private void Load()
    {
        try
        {
            if (File.Exists(_path))
            {
                var text = File.ReadAllText(_path);
                using var doc = JsonDocument.Parse(text);
                if (doc.RootElement.TryGetProperty("revision", out var rev)
                    && rev.ValueKind == JsonValueKind.Number)
                {
                    _revision = rev.GetInt64();
                }
                if (doc.RootElement.TryGetProperty("layout", out var layout))
                {
                    _current = layout.Clone();
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to load layout from {Path}", _path);
        }
        using var empty = JsonDocument.Parse("{}");
        _current = empty.RootElement.Clone();
    }
}

public sealed record LayoutSnapshot(long Revision, JsonElement Layout);
