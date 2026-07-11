using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using PzmHomeDashboard.Models;
using PzmHomeDashboard.Services;

var builder = WebApplication.CreateBuilder(args);

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
builder.Services.AddControllers();

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

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapControllers();

app.Lifetime.ApplicationStarted.Register(() =>
{
    var logger = app.Services.GetRequiredService<ILogger<Program>>();
    logger.LogInformation(
        "PZM Home Dashboard started. {Count} camera(s) configured.",
        options.Cameras.Count);
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
