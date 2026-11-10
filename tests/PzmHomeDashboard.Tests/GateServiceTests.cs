using PzmHomeDashboard.Controllers;
using PzmHomeDashboard.Models;
using Xunit;

namespace PzmHomeDashboard.Tests;

public class GateServiceTests
{
    private static (string, string) Resolve(string entity, string? contact = null, bool? toggle = null)
        => SecurityController.ResolveGateService(new GateEntity { Entity = entity, Contact = contact, Toggle = toggle });

    [Theory]
    [InlineData("switch.garage_gates", "switch", "turn_on")]
    [InlineData("input_boolean.gate", "input_boolean", "turn_on")]
    [InlineData("button.gate", "button", "press")]
    [InlineData("script.open_gate", "script", "turn_on")]
    [InlineData("cover.gate", "cover", "open_cover")]
    [InlineData("lock.door", "lock", "unlock")]
    public void Momentary_gates_fire_their_open_service(string entity, string domain, string service)
        => Assert.Equal((domain, service), Resolve(entity, contact: "binary_sensor.gate_contact"));

    [Fact]
    public void Explicit_toggle_toggles()
        => Assert.Equal(("switch", "toggle"), Resolve("switch.gate_opener", toggle: true));

    [Fact]
    public void Gate_whose_status_is_its_own_switch_toggles_by_default()
        => Assert.Equal(("switch", "toggle"), Resolve("switch.gate_opener", contact: "Switch.Gate_Opener"));

    [Fact]
    public void Explicit_false_overrides_the_default()
        => Assert.Equal(("switch", "turn_on"), Resolve("switch.gate_opener", contact: "switch.gate_opener", toggle: false));

    [Fact]
    public void No_gate_name_gets_special_treatment()
    {
        var gate = new GateEntity { Name = "Gate opener", Entity = "switch.my_own_relay" };
        Assert.Equal(("switch", "turn_on"), SecurityController.ResolveGateService(gate));
    }

    [Fact]
    public void Domains_without_a_toggle_service_keep_their_action()
        => Assert.Equal(("button", "press"), Resolve("button.gate", toggle: true));
}
