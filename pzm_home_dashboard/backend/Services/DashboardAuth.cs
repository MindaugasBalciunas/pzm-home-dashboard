using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication.Cookies;
using PzmHomeDashboard.Models;

namespace PzmHomeDashboard.Services;

// Optional username/password sign-in for direct access on the add-on port.
// The dashboard used to be open to anything on the LAN — camera stills and
// live video, presence, alarm state and every switch. Kiosk tablets reach it
// directly (not through HA ingress), so they get a classic login page and a
// long-lived session cookie instead.
public sealed class DashboardAuth
{
    public const string Scheme = CookieAuthenticationDefaults.AuthenticationScheme;
    public const string CookieName = "pzm_session";
    // A wall tablet should survive reboots and add-on updates without
    // anyone re-typing the password; the cookie slides on use.
    public static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(365);

    private const string CredentialClaim = "pzm:cred";
    // HA's ingress proxy (the Supervisor) always connects from this address;
    // HA documents it as the only source an ingress add-on should trust.
    // Those requests were already authenticated by Home Assistant.
    private static readonly IPAddress IngressProxy = IPAddress.Parse("172.30.32.2");

    private readonly byte[] _userHash;
    private readonly byte[] _passwordHash;
    private readonly string _fingerprint;

    public DashboardAuth(DashboardOptions options)
    {
        Username = string.IsNullOrWhiteSpace(options.AuthUsername) ? "admin" : options.AuthUsername.Trim();
        Enabled = !string.IsNullOrEmpty(options.AuthPassword);
        // Username is case-insensitive: tablet keyboards auto-capitalise the
        // first letter of a text field.
        _userHash = Sha256(Username.ToLowerInvariant());
        _passwordHash = Sha256(options.AuthPassword ?? "");
        // Stamped into each session (inside the encrypted cookie); a session
        // minted under different credentials no longer validates, so changing
        // the password signs every device out.
        _fingerprint = Convert.ToHexString(Sha256(Username.ToLowerInvariant() + "\n" + (options.AuthPassword ?? "")))[..32];
    }

    public bool Enabled { get; }
    public string Username { get; }

    public bool Verify(string? username, string? password)
    {
        if (!Enabled) return false;
        // Hash both sides so the comparisons are fixed-length and constant-time.
        var userOk = CryptographicOperations.FixedTimeEquals(
            Sha256((username ?? "").Trim().ToLowerInvariant()), _userHash);
        var passOk = CryptographicOperations.FixedTimeEquals(Sha256(password ?? ""), _passwordHash);
        return userOk & passOk;
    }

    public ClaimsPrincipal CreatePrincipal() => new(new ClaimsIdentity(
        new[]
        {
            new Claim(ClaimTypes.Name, Username),
            new Claim(CredentialClaim, _fingerprint),
        },
        Scheme));

    public bool IsCurrent(ClaimsPrincipal? principal)
        => principal?.FindFirst(CredentialClaim)?.Value == _fingerprint;

    public static bool IsIngress(HttpContext context)
    {
        var ip = context.Connection.RemoteIpAddress;
        if (ip is null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        return ip.Equals(IngressProxy);
    }

    // Everything — page, assets, API, HLS, snapshots — needs a session unless
    // sign-in is off or the request came through ingress.
    public bool IsSignedIn(HttpContext context)
        => !Enabled
           || IsIngress(context)
           || (context.User.Identity?.IsAuthenticated == true && IsCurrent(context.User));

    private static byte[] Sha256(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));
}
