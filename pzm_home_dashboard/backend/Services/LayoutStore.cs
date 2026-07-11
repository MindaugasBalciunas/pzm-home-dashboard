using System.Text.Json;
using System.Threading.Channels;

namespace PzmHomeDashboard.Services;

// Shared dashboard layout persisted to disk. In HAOS the /data directory is
// the addon-scoped persistent volume; locally it falls back to the app dir so
// dev picks up your saved layout across restarts.
public sealed class LayoutStore
{
    private readonly string _path;
    private readonly ILogger<LayoutStore> _log;
    private readonly List<Channel<LayoutSnapshot>> _subscribers = new();
    private readonly object _subLock = new();

    // The whole layout state is one immutable snapshot swapped atomically, so
    // a reader (GET / SSE) can never observe a JsonElement half-updated by a
    // concurrent PUT.
    private volatile LayoutSnapshot _snapshot = new(0, default);
    private long _revision;

    // Disk persistence is debounced: in-memory state and the SSE broadcast
    // update immediately, but the file is written at most once per window so
    // a drag gesture's stream of PUTs doesn't hammer eMMC/SD flash.
    private static readonly TimeSpan WriteDebounce = TimeSpan.FromSeconds(2);
    private readonly object _writeLock = new();
    private Timer? _writeTimer;
    private LayoutSnapshot? _pendingWrite;

    public LayoutStore(ILogger<LayoutStore> log)
    {
        _log = log;
        _path = ResolvePath();
        Load();
    }

    public LayoutSnapshot Get() => _snapshot;

    public Task<LayoutSnapshot> SetAsync(JsonElement layout, CancellationToken ct)
    {
        var snap = new LayoutSnapshot(Interlocked.Increment(ref _revision), layout.Clone());
        _snapshot = snap;
        ScheduleWrite(snap);
        Broadcast(snap);
        return Task.FromResult(snap);
    }

    private void ScheduleWrite(LayoutSnapshot snap)
    {
        lock (_writeLock)
        {
            _pendingWrite = snap;
            _writeTimer ??= new Timer(_ => FlushPending(), null, Timeout.Infinite, Timeout.Infinite);
            _writeTimer.Change(WriteDebounce, Timeout.InfiniteTimeSpan);
        }
    }

    private void FlushPending()
    {
        LayoutSnapshot? snap;
        lock (_writeLock) { snap = _pendingWrite; _pendingWrite = null; }
        if (snap is null) return;
        try
        {
            var json = JsonSerializer.Serialize(new { revision = snap.Revision, layout = snap.Layout });
            var dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            File.WriteAllText(_path, json);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to persist layout to {Path}", _path);
        }
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
                long revision = 0;
                if (doc.RootElement.TryGetProperty("revision", out var rev)
                    && rev.ValueKind == JsonValueKind.Number)
                {
                    revision = rev.GetInt64();
                }
                if (doc.RootElement.TryGetProperty("layout", out var layout))
                {
                    _revision = revision;
                    _snapshot = new LayoutSnapshot(revision, layout.Clone());
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to load layout from {Path}", _path);
        }
        using var empty = JsonDocument.Parse("{}");
        _snapshot = new LayoutSnapshot(0, empty.RootElement.Clone());
    }
}

public sealed record LayoutSnapshot(long Revision, JsonElement Layout);
