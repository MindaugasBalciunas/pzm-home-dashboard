# PZM Home Dashboard

A Home Assistant OS add-on that renders:

- Multiple **RTSP camera streams** — the C# backend transcodes them on demand
  to low-latency HLS, and the browser plays them with hls.js.
- A live **Solar / Grid / House card** driven by your Home Assistant Solax
  Modbus entities, with an animated flow diagram over an isometric render of
  your house.

## Install as a HAOS add-on

1. In Home Assistant → **Settings → Add-ons → Add-on Store → ⋮ → Repositories**,
   paste the URL of this Git repository and click **ADD**.
2. Refresh the add-on store. **PZM Home Dashboard** appears in a new section.
3. Click it, then **INSTALL**. First install pulls the .NET 8 SDK + Node 20 +
   ffmpeg base images and takes a few minutes.
4. Open the **Configuration** tab and fill in:
   - **cameras** — one entry per RTSP source. Fill in `url`, `username`,
     `password`, `transport` (`tcp` or `udp`).
   - **home_assistant.solar** — the entity IDs for your inverter. Defaults
     match the [wills106 solax_modbus](https://github.com/wills106/homeassistant-solax-modbus)
     naming for a Gen4 X3-Hybrid. Change any that differ.
   - Leave `home_assistant.use_supervisor: true`, and leave `base_url` and
     `token` blank — the supervisor injects a scoped token via
     `homeassistant_api: true`.
5. **Start** the add-on. Once healthy, click **OPEN WEB UI**.
6. Drag / resize any tile via the **Edit** button (bottom-right of the
   dashboard). The layout is saved per-browser in `localStorage`.

### Custom house image

The Electricity card overlays live callouts (`Solar`, `PV 1`, `PV 2`, `Home`,
`Grid`) on top of an image at `/house.png` (served from
`pzm_home_dashboard/frontend/public/`). Drop your own transparent-background
isometric render there; if you keep the aspect ratio close to 2682 × 1600 the
callout positions in `pzm_home_dashboard/frontend/src/components/SolarCard.jsx`
map cleanly to the roof panels / garage / fence corner. Otherwise adjust the
numbers inside `<HouseView>`.

## Repository layout

```
repository.yaml                    HAOS add-on repository manifest
pzm_home_dashboard/                The add-on itself
  config.yaml                        HAOS add-on manifest
  Dockerfile                         Multi-stage build (Node → .NET → runtime + ffmpeg)
  run.sh                             Add-on entrypoint
  backend/                           ASP.NET Core 8 API
    Program.cs
    Controllers/                     /api/cameras · /hls · /api/ha/solar[/history|/monthly]
    Services/                        StreamManager (ffmpeg-per-camera), HomeAssistantClient
    Models/
  frontend/                          React 18 + Vite + hls.js
    src/
      App.jsx                        Grid layout with drag/resize
      components/
        CameraTile.jsx               HLS video tile
        SolarCard.jsx                HouseView + energy chips
    public/
      house.png                      Isometric house image (drop your own here)
```

## Local development

The backend loads `appsettings.Development.json` on top of `appsettings.json`
when `ASPNETCORE_ENVIRONMENT=Development`. Both files are read from the
`backend/` directory. Development is git-ignored, so put your real HA token
and camera passwords there.

```bash
# One-time setup (macOS)
brew install ffmpeg dotnet@8

# Backend
cd pzm_home_dashboard/backend
ASPNETCORE_URLS=http://0.0.0.0:8099 \
ASPNETCORE_ENVIRONMENT=Development \
HLS_ROOT=/tmp/pzm-hls \
dotnet run --no-launch-profile

# Frontend (in another shell)
cd pzm_home_dashboard/frontend
npm install
npm run dev   # http://localhost:5173/
```

Vite proxies `/api` and `/hls` to `:8099` so both work seamlessly.

`pzm_home_dashboard/frontend/src/components/SolarCard.jsx` fetches history for
`hours = hours-since-local-midnight` from `/api/ha/solar/history`. `Total Solar`
uses the long-term-statistics WebSocket API (`recorder/statistics_during_period`)
and shows 12 monthly bars.

## Home Assistant configuration reference

Everything the add-on reads is available under the `Dashboard` section of
`appsettings.json` (see the template) or via HAOS options (see
`config.yaml`). Both shapes bind to the same
`PzmHomeDashboard.Models.DashboardOptions`.

## License

Personal project, no license granted yet.
