namespace PzmHomeDashboard.Services;

// Decides whether a state-changing request was initiated by a different
// origin than the one serving the dashboard (see the guard in Program.cs).
public static class RequestOrigin
{
    public static bool IsCrossOrigin(HttpRequest request, bool viaIngress)
    {
        if (string.Equals(request.Headers["Sec-Fetch-Site"], "cross-site", StringComparison.OrdinalIgnoreCase))
            return true;

        // Through HA ingress the browser's origin is Home Assistant's own
        // (e.g. http://homeassistant.local:8123) while the Supervisor proxy
        // talks to us under an internal host, so the two can never match.
        // Those requests are already authenticated by Home Assistant.
        if (viaIngress) return false;

        var origin = request.Headers.Origin.ToString();
        // Non-browser clients (curl, scripts) and same-origin GET-style
        // navigations send no Origin; they aren't a cross-site vector.
        if (string.IsNullOrEmpty(origin)) return false;
        // "null" = sandboxed iframe, file:// page, redirected cross-origin POST.
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return true;

        // Host is what the browser addressed; X-Forwarded-Host covers a
        // reverse proxy that rewrites Host. A cross-site form can set
        // neither, so matching either one proves the page is ours.
        return !SameAuthority(uri, request.Host.Value)
            && !SameAuthority(uri, request.Headers["X-Forwarded-Host"].ToString());
    }

    private static bool SameAuthority(Uri origin, string? hostHeader)
    {
        if (string.IsNullOrWhiteSpace(hostHeader)) return false;
        // A proxy chain may append hosts; the first is the one the browser used.
        var host = hostHeader.Split(',')[0].Trim();
        if (string.Equals(origin.Authority, host, StringComparison.OrdinalIgnoreCase)) return true;
        // Origin omits a default port (":80"/":443"); Host may spell it out.
        return origin.IsDefaultPort
            && string.Equals($"{origin.Host}:{origin.Port}", host, StringComparison.OrdinalIgnoreCase);
    }
}
