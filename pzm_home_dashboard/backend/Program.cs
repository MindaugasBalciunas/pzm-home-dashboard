using System.Text.Json;
using PzmHomeDashboard.Models;
using PzmHomeDashboard.Services;

var builder = WebApplication.CreateBuilder(args);

var options = LoadDashboardOptions(builder.Configuration);
builder.Services.AddSingleton(options);
builder.Services.AddSingleton(options.HomeAssistant);
builder.Services.AddSingleton<CameraRegistry>();
builder.Services.AddSingleton<StreamManager>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<StreamManager>());
builder.Services.AddHttpClient();
builder.Services.AddSingleton<HomeAssistantClient>();
builder.Services.AddControllers();

var app = builder.Build();

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
