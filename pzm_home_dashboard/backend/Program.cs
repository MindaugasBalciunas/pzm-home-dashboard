using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.ResponseCompression;
using PzmHomeDashboard.Models;
using PzmHomeDashboard.Services;

var builder = WebApplication.CreateBuilder(args);

// Non-blocking console logging. The default console logger's queue-full mode
// is Wait: under a log flood the supervisor's stdout pipe can't drain fast
// enough, the queue fills, and every thread that logs (Kestrel request
// threads, ffmpeg stderr readers) BLOCKS — which stalled the whole web UI.
// DropWrite discards excess log lines instead of blocking the caller, so a
// flood can degrade logging but never wedge the server. Re-configures the
// already-registered console provider (no duplicate output).
builder.Logging.AddConsole(o =>
{
    o.QueueFullMode = Microsoft.Extensions.Logging.Console.ConsoleLoggerQueueFullMode.DropWrite;
    o.MaxQueueLength = 8192;
});

var options = LoadDashboardOptions(builder.Configuration);
builder.Services.AddSingleton(options);
builder.Services.AddSingleton(options.HomeAssistant);
builder.Services.AddSingleton<CameraRegistry>();
builder.Services.AddSingleton<CameraSnapshotService>();
builder.Services.AddSingleton<StreamManager>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<StreamManager>());
builder.Services.AddHttpClient();
builder.Services.AddSingleton<HomeAssistantClient>();
builder.Services.AddSingleton<WeatherService>();
builder.Services.AddSingleton<LayoutStore>();
builder.Services.AddSingleton<DashboardAuth>();
builder.Services.AddControllers();

// Session cookies are encrypted with Data Protection keys. Persist them on
// the add-on's /data volume: with the default in-memory keys every restart
// or update would sign the kiosk tablet out.
builder.Services.AddDataProtection()
    .SetApplicationName("pzm-home-dashboard")
    .PersistKeysToFileSystem(new DirectoryInfo(ResolveKeysDir()));
builder.Services.AddAuthentication(DashboardAuth.Scheme)
    .AddCookie(DashboardAuth.Scheme, o =>
    {
        o.Cookie.Name = DashboardAuth.CookieName;
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = DashboardAuth.SessionLifetime;
        o.SlidingExpiration = true;
        // A session minted under old credentials (password since changed)
        // is dropped here; the gate below then sends the client to /login.
        o.Events.OnValidatePrincipal = ctx =>
        {
            var auth = ctx.HttpContext.RequestServices.GetRequiredService<DashboardAuth>();
            if (!auth.IsCurrent(ctx.Principal)) ctx.RejectPrincipal();
            return Task.CompletedTask;
        };
    });

// Brute-force brake on the sign-in form: 5 attempts per minute per client.
builder.Services.AddRateLimiter(o =>
{
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
    o.OnRejected = (ctx, _) =>
    {
        ctx.HttpContext.Response.Redirect("login?error=locked");
        return ValueTask.CompletedTask;
    };
});

// Layout PUTs (including backup restores) are the largest bodies this app
// accepts, and those are tens of kB. Kestrel's 30 MB default would let any
// LAN client push a huge layout into memory, every SSE subscriber and
// /data/layout.json.
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 4 * 1024 * 1024);

// The JS bundle is ~650 kB raw / ~200 kB compressed — on a weak kiosk
// tablet or through HA ingress that's the bulk of a cold load. Fastest
// levels keep the CPU cost negligible on ARM; hashed assets are then cached
// immutably (below), so each client pays it once per release. SSE
// (text/event-stream) and HLS types aren't in the default MIME list, so
// streaming responses are never buffered by the compressor.
builder.Services.AddResponseCompression(o =>
{
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);

var app = builder.Build();

// LAN-only guard: the add-on has no authentication of its own (HA ingress
// provides it), so if the 8099 port mapping is ever enabled — or forwarded
// at the router — refuse anything that doesn't originate from a private
// network. Ingress arrives from the supervisor network (172.30.32.x) and
// Tailscale from CGNAT space, both of which stay allowed. Deliberately no
// X-Forwarded-For handling: the socket address is the only source we trust.
app.Use(async (context, next) =>
{
    var ip = context.Connection.RemoteIpAddress;
    if (ip is null || !IsLocalSource(ip))
    {
        var logger = context.RequestServices.GetRequiredService<ILogger<Program>>();
        logger.LogWarning(
            "Rejected request to {Path} from non-local address {Ip}.",
            context.Request.Path, ip);
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsync("This dashboard is only available on the local network.");
        return;
    }
    await next();
});

// Cross-site request guard. The LAN check above trusts anything on the
// network, but a page the kiosk owner (or a guest on the wifi) opens in a
// browser is also "on the network": a plain cross-origin <form> POST needs
// no CORS preflight and could fire /api/ha/security/gate/0 — opening a gate
// — with no JSON body at all. Browsers stamp every request with
// Sec-Fetch-Site, so refuse state-changing requests a different site
// initiated. Same-origin (kiosk, ingress iframe) and non-browser clients
// (no header) are unaffected.
app.Use(async (context, next) =>
{
    var method = context.Request.Method;
    if (!HttpMethods.IsGet(method) && !HttpMethods.IsHead(method) && !HttpMethods.IsOptions(method)
        && string.Equals(context.Request.Headers["Sec-Fetch-Site"], "cross-site", StringComparison.OrdinalIgnoreCase))
    {
        var logger = context.RequestServices.GetRequiredService<ILogger<Program>>();
        logger.LogWarning(
            "Rejected cross-site {Method} to {Path} (Origin: {Origin}).",
            method, context.Request.Path, context.Request.Headers.Origin.ToString());
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    await next();
});

app.UseResponseCompression();
app.UseRateLimiter();
app.UseAuthentication();

// Sign-in gate. Runs before static files so the bundle, HLS video and camera
// stills are covered too, not just the API. A browser opening the page is
// sent to the login form; anything else gets a bare 401 (the frontend turns
// that into a reload, which lands on the form).
app.Use(async (context, next) =>
{
    var auth = context.RequestServices.GetRequiredService<DashboardAuth>();
    var path = context.Request.Path;
    if (auth.IsSignedIn(context)
        || path.Equals("/login", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/logout", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }
    if (HttpMethods.IsGet(context.Request.Method)
        && (path == "/" || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase)))
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Redirect("login");
        return;
    }
    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
});

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // Vite content-hashes everything under assets/, so those can be cached
    // forever — a kiosk reload then costs one index.html revalidation
    // instead of a conditional request per chunk (each a full round trip
    // through HA ingress). index.html and unhashed files must revalidate so
    // a new release is picked up immediately.
    OnPrepareResponse = ctx =>
    {
        var path = ctx.Context.Request.Path.Value ?? "";
        ctx.Context.Response.Headers.CacheControl =
            path.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase)
                ? "public, max-age=31536000, immutable"
                : "no-cache";
    },
});
app.MapControllers();

app.Lifetime.ApplicationStarted.Register(() =>
{
    var logger = app.Services.GetRequiredService<ILogger<Program>>();
    logger.LogInformation(
        "PZM Home Dashboard started. {Count} camera(s) configured.",
        options.Cameras.Count);
    if (app.Services.GetRequiredService<DashboardAuth>().Enabled)
        logger.LogInformation("Sign-in required for direct access (ingress is exempt).");
    else
        logger.LogWarning(
            "No auth_password set: anyone on the LAN who can reach the add-on port can view cameras "
            + "and control devices. Set auth_password in the add-on options to require sign-in.");
});

app.Run();

static DashboardOptions LoadDashboardOptions(IConfiguration configuration)
{
    var file = Environment.GetEnvironmentVariable("RTSPVIEWER_OPTIONS_FILE");
    if (!string.IsNullOrWhiteSpace(file) && File.Exists(file))
    {
        var json = File.ReadAllText(file);
        var loaded = JsonSerializer.Deserialize<DashboardOptions>(
            json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (loaded is not null)
        {
            return loaded;
        }
    }

    var fromConfig = new DashboardOptions();
    configuration.GetSection("Dashboard").Bind(fromConfig);
    return fromConfig;
}

static string ResolveKeysDir()
{
    var env = Environment.GetEnvironmentVariable("PZM_KEYS_PATH");
    if (!string.IsNullOrWhiteSpace(env)) return env;
    if (Directory.Exists("/data")) return "/data/keys";
    return Path.Combine(AppContext.BaseDirectory, "keys");
}

static bool IsLocalSource(IPAddress ip)
{
    if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
    if (IPAddress.IsLoopback(ip)) return true;

    var b = ip.GetAddressBytes();
    if (ip.AddressFamily == AddressFamily.InterNetwork)
    {
        return b[0] == 10                            // 10.0.0.0/8
            || (b[0] == 172 && (b[1] & 0xF0) == 16)  // 172.16.0.0/12 (incl. supervisor/ingress)
            || (b[0] == 192 && b[1] == 168)          // 192.168.0.0/16
            || (b[0] == 169 && b[1] == 254)          // 169.254.0.0/16 link-local
            || (b[0] == 100 && (b[1] & 0xC0) == 64); // 100.64.0.0/10 CGNAT (Tailscale)
    }
    if (ip.AddressFamily == AddressFamily.InterNetworkV6)
    {
        return (b[0] & 0xFE) == 0xFC                    // fc00::/7 unique-local
            || (b[0] == 0xFE && (b[1] & 0xC0) == 0x80); // fe80::/10 link-local
    }
    return false;
}
