using System.Text;
using PzmHomeDashboard.Models;

namespace PzmHomeDashboard.Services;

public sealed class CameraRegistry
{
    private readonly Dictionary<string, CameraOptions> _byId = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<CameraDto> _dtos = new();

    public CameraRegistry(DashboardOptions options)
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < options.Cameras.Count; i++)
        {
            var cam = options.Cameras[i];
            var id = MakeUniqueId(Slugify(cam.Name), i, used);
            used.Add(id);
            _byId[id] = cam;
            _dtos.Add(new CameraDto(id, string.IsNullOrWhiteSpace(cam.Name) ? id : cam.Name));
        }
    }

    public IReadOnlyList<CameraDto> List() => _dtos;

    public bool TryGet(string id, out CameraOptions camera)
    {
        if (_byId.TryGetValue(id, out var found))
        {
            camera = found;
            return true;
        }
        camera = default!;
        return false;
    }

    public IEnumerable<string> Ids => _byId.Keys;

    private static string MakeUniqueId(string baseId, int index, HashSet<string> used)
    {
        var candidate = string.IsNullOrEmpty(baseId) ? $"camera-{index + 1}" : baseId;
        if (!used.Contains(candidate)) return candidate;
        var n = 2;
        while (used.Contains($"{candidate}-{n}")) n++;
        return $"{candidate}-{n}";
    }

    private static string Slugify(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";
        var sb = new StringBuilder(name.Length);
        var lastDash = false;
        foreach (var raw in name.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(raw))
            {
                sb.Append(raw);
                lastDash = false;
            }
            else if (!lastDash)
            {
                sb.Append('-');
                lastDash = true;
            }
        }
        return sb.ToString().Trim('-');
    }
}
