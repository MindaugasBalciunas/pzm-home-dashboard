using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using PzmHomeDashboard.Services;

namespace PzmHomeDashboard.Controllers;

// Sign-in for direct (non-ingress) access. Every URL here is relative and
// sits at the root (/login, /logout), so redirects resolve correctly whatever
// path prefix the page is served under.
[ApiController]
public sealed class AuthController : ControllerBase
{
    private readonly DashboardAuth _auth;
    private readonly ILogger<AuthController> _log;

    public AuthController(DashboardAuth auth, ILogger<AuthController> log)
    {
        _auth = auth;
        _log = log;
    }

    [HttpGet("login")]
    public IActionResult LoginPage([FromQuery] string? error)
    {
        if (_auth.IsSignedIn(HttpContext)) return Redirect("./");
        var message = error switch
        {
            "1" => "Wrong username or password.",
            "locked" => "Too many attempts. Wait a minute and try again.",
            _ => null,
        };
        Response.Headers.CacheControl = "no-store";
        return Content(LoginHtml(message), "text/html; charset=utf-8");
    }

    public sealed class LoginForm
    {
        public string? Username { get; set; }
        public string? Password { get; set; }
    }

    [HttpPost("login")]
    [Consumes("application/x-www-form-urlencoded")]
    [EnableRateLimiting("login")]
    public async Task<IActionResult> Login([FromForm] LoginForm form)
    {
        var ip = HttpContext.Connection.RemoteIpAddress;
        if (!_auth.Verify(form.Username, form.Password))
        {
            _log.LogWarning("Failed dashboard sign-in from {Ip}.", ip);
            return Redirect("login?error=1");
        }

        await HttpContext.SignInAsync(
            DashboardAuth.Scheme,
            _auth.CreatePrincipal(),
            new AuthenticationProperties { IsPersistent = true });
        _log.LogInformation("Dashboard sign-in from {Ip}.", ip);
        return Redirect("./");
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(DashboardAuth.Scheme);
        return NoContent();
    }

    // Lets the side menu offer "Sign out" only where it means something.
    [HttpGet("api/auth/status")]
    public IActionResult Status()
    {
        Response.Headers.CacheControl = "no-store";
        var viaIngress = DashboardAuth.IsIngress(HttpContext);
        return Ok(new
        {
            enabled = _auth.Enabled,
            ingress = viaIngress,
            user = _auth.Enabled && !viaIngress ? HttpContext.User.Identity?.Name : null,
        });
    }

    // Self-contained page (no bundle, no external assets): it is served to
    // clients that may not fetch anything else yet.
    private static string LoginHtml(string? message) => $$"""
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <meta name="theme-color" content="#0f1216" />
          <meta name="robots" content="noindex" />
          <title>Sign in · PZM Home</title>
          <style>
            :root { color-scheme: dark; }
            * { box-sizing: border-box; }
            body {
              margin: 0; min-height: 100vh; display: grid; place-items: center;
              background: #0f1216; color: #e8edf2;
              font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
              padding: 16px;
            }
            form {
              width: 100%; max-width: 360px; padding: 28px 24px;
              background: #171c22; border: 1px solid #262e38; border-radius: 14px;
              display: grid; gap: 14px;
            }
            h1 { margin: 0 0 4px; font-size: 1.25rem; font-weight: 700; }
            label { display: grid; gap: 6px; font-size: 0.85rem; color: #9aa7b4; }
            input {
              font: inherit; color: inherit; background: #0f1216;
              border: 1px solid #2f3945; border-radius: 10px; padding: 12px 14px;
            }
            input:focus { outline: 2px solid #3d8bfd; outline-offset: 1px; border-color: transparent; }
            button {
              font: inherit; font-weight: 700; margin-top: 6px; padding: 12px;
              border: 0; border-radius: 10px; background: #3d8bfd; color: #fff; cursor: pointer;
            }
            .error {
              margin: 0; padding: 10px 12px; border-radius: 10px;
              background: rgba(239, 68, 68, 0.12); color: #fca5a5; font-size: 0.9rem;
            }
          </style>
        </head>
        <body>
          <form method="post" action="login">
            <h1>PZM Home</h1>
            {{(message is null ? "" : $"<p class=\"error\" role=\"alert\">{message}</p>")}}
            <label>Username
              <input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus />
            </label>
            <label>Password
              <input name="password" type="password" autocomplete="current-password" required />
            </label>
            <button type="submit">Sign in</button>
          </form>
        </body>
        </html>
        """;
}
