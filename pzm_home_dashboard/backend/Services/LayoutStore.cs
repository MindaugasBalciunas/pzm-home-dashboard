using System.Text.Json;
using System.Threading.Channels;

namespace PzmHomeDashboard.Services;

// Shared dashboard layout persisted to disk. In HAOS the /data directory is
// the addon-scoped persistent volume; locally it falls back to the app dir so
// dev picks up your saved layout across restarts.
public sealed class LayoutStore : IDisposable
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
    // Serialises the file I/O itself: the debounce timer and the shutdown
    // flush can otherwise both be inside FlushPending at once.
    private readonly object _ioLock = new();
    private bool _disposed;

    public LayoutStore(ILogger<LayoutStore> log) : this(log, ResolvePath())
    {
    }

    // Explicit path, for tests.
    internal LayoutStore(ILogger<LayoutStore> log, string path)
    {
        _log = log;
        _path = path;
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
            if (_disposed) return;
            _writeTimer ??= new Timer(_ => FlushPending(), null, Timeout.Infinite, Timeout.Infinite);
            _writeTimer.Change(WriteDebounce, Timeout.InfiniteTimeSpan);
        }
    }

    private void FlushPending()
    {
        lock (_ioLock)
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
                // Never write the live file in place: a power cut mid-write
                // left a truncated layout.json, the next start served an
                // empty layout and the first browser seeded the starter
                // template over it. Write a sibling temp file, force it to
                // disk, then swap it in with a rename (atomic on the same
                // volume); the file being replaced becomes the .bak that
                // Load() falls back to.
                var tmp = _path + ".tmp";
                using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    var bytes = System.Text.Encoding.UTF8.GetBytes(json);
                    fs.Write(bytes, 0, bytes.Length);
                    fs.Flush(flushToDisk: true);
                }
                if (File.Exists(_path)) File.Replace(tmp, _path, BackupPath);
                else File.Move(tmp, _path);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Failed to persist layout to {Path}", _path);
                // Keep it queued so the next save (or shutdown) retries,
                // unless something newer was scheduled in the meantime.
                lock (_writeLock) _pendingWrite ??= snap;
            }
        }
    }

    private string BackupPath => _path + ".bak";

    // The container disposes singletons on host shutdown. Write out whatever
    // the debounce window is still holding — otherwise an edit made in the
    // last couple of seconds before an add-on restart/update was dropped.
    public void Dispose()
    {
        Timer? timer;
        lock (_writeLock)
        {
            if (_disposed) return;
            _disposed = true;
            timer = _writeTimer;
            _writeTimer = null;
        }
        timer?.Dispose();
        FlushPending();
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
        // The previous good copy is tried when the live file is missing,
        // truncated or otherwise unreadable.
        foreach (var candidate in new[] { _path, BackupPath })
        {
            if (TryLoadFile(candidate, out var snap))
            {
                if (candidate != _path)
                    _log.LogWarning("Layout restored from backup {Path}.", candidate);
                _revision = snap.Revision;
                _snapshot = snap;
                return;
            }
        }
        using var empty = JsonDocument.Parse("{}");
        _snapshot = new LayoutSnapshot(0, empty.RootElement.Clone());
    }

    private bool TryLoadFile(string path, out LayoutSnapshot snapshot)
    {
        snapshot = default!;
        try
        {
            if (!File.Exists(path)) return false;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            long revision = 0;
            if (doc.RootElement.TryGetProperty("revision", out var rev)
                && rev.ValueKind == JsonValueKind.Number)
            {
                revision = rev.GetInt64();
            }
            if (!doc.RootElement.TryGetProperty("layout", out var layout)
                || layout.ValueKind != JsonValueKind.Object)
            {
                _log.LogWarning("Layout file {Path} has no layout object; ignoring it.", path);
                return false;
            }
            snapshot = new LayoutSnapshot(revision, layout.Clone());
            return true;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to load layout from {Path}", path);
            return false;
        }
    }
}

public sealed record LayoutSnapshot(long Revision, JsonElement Layout);
