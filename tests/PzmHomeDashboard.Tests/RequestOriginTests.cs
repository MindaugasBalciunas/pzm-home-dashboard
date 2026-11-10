using Microsoft.AspNetCore.Http;
using PzmHomeDashboard.Services;
using Xunit;

namespace PzmHomeDashboard.Tests;

public class RequestOriginTests
{
    private static HttpRequest Request(string host, string? origin = null, string? fetchSite = null, string? forwardedHost = null)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = "POST";
        ctx.Request.Host = new HostString(host);
        if (origin is not null) ctx.Request.Headers.Origin = origin;
        if (fetchSite is not null) ctx.Request.Headers["Sec-Fetch-Site"] = fetchSite;
        if (forwardedHost is not null) ctx.Request.Headers["X-Forwarded-Host"] = forwardedHost;
        return ctx.Request;
    }

    [Fact]
    public void Same_origin_is_allowed()
        => Assert.False(RequestOrigin.IsCrossOrigin(
            Request("192.168.1.5:8099", "http://192.168.1.5:8099", "same-origin"), viaIngress: false));

    [Fact]
    public void Clients_without_an_origin_are_allowed()
        => Assert.False(RequestOrigin.IsCrossOrigin(Request("192.168.1.5:8099"), viaIngress: false));

    [Fact]
    public void Sec_fetch_cross_site_is_refused()
        => Assert.True(RequestOrigin.IsCrossOrigin(
            Request("192.168.1.5:8099", "https://evil.example", "cross-site"), viaIngress: false));

    [Fact]
    public void Foreign_origin_is_refused_even_without_sec_fetch_headers()
        => Assert.True(RequestOrigin.IsCrossOrigin(
            Request("192.168.1.5:8099", "https://evil.example"), viaIngress: false));

    [Fact]
    public void Another_port_on_the_same_ip_is_refused()
        => Assert.True(RequestOrigin.IsCrossOrigin(
            Request("192.168.1.5:8099", "http://192.168.1.5:8123", "same-site"), viaIngress: false));

    [Fact]
    public void Opaque_origin_is_refused()
        => Assert.True(RequestOrigin.IsCrossOrigin(Request("192.168.1.5:8099", "null"), viaIngress: false));

    [Fact]
    public void Host_comparison_ignores_case_and_default_ports()
    {
        Assert.False(RequestOrigin.IsCrossOrigin(Request("Dash.Home.LAN", "http://dash.home.lan"), viaIngress: false));
        Assert.False(RequestOrigin.IsCrossOrigin(Request("dash.home.lan:443", "https://dash.home.lan"), viaIngress: false));
    }

    [Fact]
    public void Reverse_proxy_forwarded_host_counts()
        => Assert.False(RequestOrigin.IsCrossOrigin(
            Request("127.0.0.1:8099", "https://dash.example.org", forwardedHost: "dash.example.org"), viaIngress: false));

    [Fact]
    public void Ingress_is_exempt_from_the_origin_match_but_not_from_sec_fetch()
    {
        Assert.False(RequestOrigin.IsCrossOrigin(
            Request("172.30.33.4:8099", "http://homeassistant.local:8123", "same-origin"), viaIngress: true));
        Assert.True(RequestOrigin.IsCrossOrigin(
            Request("172.30.33.4:8099", "https://evil.example", "cross-site"), viaIngress: true));
    }
}
