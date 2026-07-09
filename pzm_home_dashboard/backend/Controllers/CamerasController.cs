using Microsoft.AspNetCore.Mvc;
using PzmHomeDashboard.Services;

namespace PzmHomeDashboard.Controllers;

[ApiController]
[Route("api/cameras")]
public sealed class CamerasController : ControllerBase
{
    private readonly CameraRegistry _registry;

    public CamerasController(CameraRegistry registry)
    {
        _registry = registry;
    }

    [HttpGet]
    public IActionResult List() => Ok(_registry.List());
}
