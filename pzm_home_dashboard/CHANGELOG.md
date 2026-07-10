# Changelog

All notable changes to the **PZM Home Dashboard** add-on are listed here.
The format follows Home Assistant's convention: the newest release comes first
and version headers match the `version:` field in `config.yaml`.

## 0.2.18

- **Garage gate shows the actual door state.** The gate contact now points
  at the dedicated Zigbee door sensor
  (`binary_sensor.garage_gates_contact_sensor_door`); the backend remaps
  the stale Eldes-zone contact from older saved options automatically, so
  the state is correct even with Zones hidden.
- **Touch editing reworked.** In edit mode, hold a tile (~350 ms) to lift
  it — pop scale, shadow ring and a haptic tick — then drag to move; a
  stray swipe no longer drags tiles. Tap a custom tile to edit it. Mouse
  drags stay instant; the resize handle works as before and pops too.
- **Security card options moved into a dialog.** Tap the Security tile in
  edit mode to open it; Zones and PIR sections toggle Shown/Hidden there
  and persist in the shared layout.
- **Security layouts leverage the tile shape.** Portrait tiles stack gates
  as full-label rows (no more icon-only squeeze); landscape/wide tiles let
  zone chips flow into as many columns as fit.
- **Electricity tile fills its box.** The house photo now covers the area
  above the graph strip, zooming in/out with the tile instead of
  letterboxing; callout cards get compressed padding and type on small
  tiles so the numbers keep their room.

## 0.2.17

- **Security card display toggles.** In layout-edit mode the Security tile
  now shows *Zones* and *PIR* on/off chips — turn either section's display
  off and the choice persists in the shared layout (all clients follow).
- **Sharper buttons**: corner rounding halved (`--radius-sm` 8→4 px,
  `--radius-md` 12→6 px) across buttons and number tiles.
- **Themed icon packs.** Every catalog icon now carries a pack tag and the
  icon picker gained a pack-chips row (Lighting, Switches, Doors, Climate,
  Kitchen, …) alongside search. Four new packs land with 21 new icons:
  Transport (bus, train, plane, boat, truck), Holidays (xmas-tree,
  snowflake, snowman, pumpkin, fireworks, balloon), Fitness (dumbbell,
  running, pulse, pill, first-aid) and Food & drink (burger, cake, beer,
  cocktail, ice-cream).

## 0.2.16

- **Glassy callout cards.** The floating stat cards over the house photo
  are now translucent (dark: 35 % tint, light: 45 %) so the scene shows
  through; the existing backdrop blur + text shadows keep values readable
  on both bright day and dark night renders.

## 0.2.15

- **Season & time-of-day house photos.** The Electricity tile now picks its
  background from 16 shipped renders (`<season>-<phase>.png`, 4 seasons ×
  morning/day/evening/night) by the wall clock: months map to seasons and
  hours map to phases (06–10 morning, 11–16 day, 17–21 evening, else night).
  Background swaps crossfade instead of popping.
- **Experiments section in the side menu** with a **BG demo loop** button:
  cycles the photo through every variant every 2 s with a season · phase
  label pill, for eyeballing all 16 renders without waiting a year.
- Renamed `autum-night.png` → `autumn-night.png`.

## 0.2.14

- **Electricity tile spacing tightened**: top padding removed and side /
  bottom padding reduced to a hairline, so the house view spans nearly the
  full tile width.
- **Callout cards sit higher**: the house view is top-anchored (slack now
  falls between the photo and the bottom strip instead of above), and the
  Solar / PV1 / PV2 / Home callouts moved up to ~1.5% from the top edge.

## 0.2.13

- **Solax row now works on upgraded installs without a config edit.**
  Supervisor keeps an install's saved options when an add-on adds new keys,
  so 0.2.12's `solax_today_*` options resolved to nothing on existing
  installs and the row stayed hidden. The defaults now live in the backend
  model too, and point at the Solax **energy-dashboard** sensors
  (`solax_grid_import_energy`, `solax_grid_export_energy`,
  `garage…solax_home_consumption_energy`) as a grid-side comparison against
  the P1 meter. Set a key to `""` to hide its cell.
- Grid callout caption renamed **Solax today → Solax** since the
  energy-dashboard sensors are cumulative rather than daily.

## 0.2.12

- **Solar callout enriched**: lifetime Total sits beside Today in a two-column
  row, with peak PV output today in the label row, a 7-day generation column
  chart with weekday initials, and best/lowest day annotations.
- **Grid callout refocused on live + inverter-side reads**: a mirrored hourly
  chart (export up in green, import down in red) with today's peak export /
  import, plus a new **Solax today** three-up row (Imp | Exp | House).
- **New options** `solax_today_import`, `solax_today_export` and
  `solax_today_house` feed the Solax daily row; `today_import`/`today_export`
  are now intended for the P1 meter's daily cycles.
- **Home callout is the P1 hub**: P1 Imp/Exp *today* and *total* in a 2×2
  grid with T1/T2 tariff splits, all explicitly "P1"-prefixed.
- **Energy strip pinned to the tile bottom** and trimmed to Today Solar /
  PV 1 / PV 2; chips reflow by width and scale their height with the tile.
- **Dynamic sizing** via container queries: the house photo keeps its aspect
  ratio while flexing, callouts enlarge on wide tiles, and mini charts /
  two-column stat rows collapse gracefully on narrow ones.

## 0.2.11

- **Electricity panel: isometric house visualization** inspired by the actual
  backyard aerial photo. The flow diagram is now a 3D house SVG with a
  reddish-brown tiled roof, solar panels on the right slope, a garage with
  electric car, a heat pump, and an inverter box on the right wall.
- **Glassmorphic floating cards** overlay the house — Solar (top-right), Home
  (top-left), Grid (bottom-right) and optionally Battery — showing live W/kW
  values and colour-coded by direction (amber solar, green export, red import,
  teal battery).
- **PV1/PV2 split** now shown in the Solar card as `PV1: 1.2kW (55%) · PV2: 1.0kW (45%)`.
- **Battery support**: new `battery_power` and `battery_soc` option fields;
  a Battery power cell auto-appears when configured.
- **Power cell grid** consolidated to Solar / House / Grid / Battery (3-4 cols),
  each with a background area sparkline that fills behind the live value.
- **Single-line energy stats bar** (Today Solar / Export / Import / Total).
- CSS `--house-wall`, `--roof-color`, `--card-bg` custom properties themed for
  both dark and light colour schemes.

## 0.2.10

- **LED colour actually works now**. `entity/action` was serialising
  JSON arrays (`rgb_color: [0, 111, 255]`) as raw-JSON strings so Home
  Assistant ignored the parameter. `JsonToObject` now recurses into
  arrays and objects, so `rgb_color`, `hs_color`, and any other list /
  dict argument round-trip correctly.
- **Light modal grows a Pattern / Effect picker** for WLED-style
  RGBIC strips. Backend `LightAttrs` now carries `effect`,
  `effectList`, `colorMode`, and `supportedColorModes`.
- **Number tiles can pick an icon** now — the icon picker is shown for
  both button and number kinds in the add + edit modals, and
  `NumberTileIcon` honours `spec.icon` before falling back to
  heuristics.
- **Electricity tile**: Solar (PV Total) callout enlarged and now
  carries a "Today" sub-line with cumulative kWh harvested so far.
  Home callout enlarged and moved up next to PV — the flow line now
  terminates at the callout's edge instead of running under it. House
  background zoomed ~116% for a bigger, more legible image; inner
  padding shrunk on all sides.
- **Today Solar chip** now shows hourly bars of PV production (from
  `pvTotal` history bucketed by hour) instead of the cumulative
  today-solar area chart — reads directly as "how much did we make
  each hour today."
- **Total Solar chip** switched from monthly bars (last 12 months) to
  daily columns for the last 7 days. New backend endpoint
  `/api/ha/solar/daily?days=N` powered by the same recorder statistics
  path as the monthly view.
- **Security card**: gate buttons stack vertically in landscape /
  wide layouts (thumb-friendly on horizontal tiles) and their names
  wrap to two lines instead of getting truncated with an ellipsis. In
  portrait the gate row stays horizontal but narrower buttons fall
  back to icon-only. Zones ↔ PIR gap tightened by ~40%.
- **Zone / PIR chips restyled again**: no border, icon + label
  together whenever the chip has room; only the icon shows when the
  chip is genuinely too narrow for the smallest label. No ellipsis
  ever. Contact-state parser tolerates more state values (motion,
  detected, tampered, wet, alarm…) and treats empty / unknown /
  unavailable as neutral instead of "off / OK".
- **Rounded corners** across custom tiles (buttons + numbers), gate
  buttons and tile-inner icon halos, driven by `--radius-sm` /
  `--radius-md` variables. Overall padding tightened on gate row,
  custom-button inner, and security section gap.
- **Icon catalog expanded to ~180 glyphs**. First pass revised the
  weakest paths (bed, sofa, kitchen, stairs, garage, outlet, light,
  torch, lamp). Second pass added ~50 variants so the picker offers
  multiple visual styles for the same concept (Edison / round / flame
  bulbs; single vs double vs sliding vs glass doors; padlock vs smart
  vs deadbolt; single vs double vs crib beds; side / front / SUV cars;
  dome / bullet / PTZ cameras; radar; skylight; armchair / stool /
  bench; mug / glass / wine; flower / cactus / palm; tools; weather
  variants; hammock / firepit / BBQ).

## 0.2.9

- **Zone / PIR chips restyled as status, not buttons**. The rectangle
  border and tinted background are gone — the label just colours by
  state (green ok / red bad, red pulses subtle opacity). When the chip
  is wide enough it shows only the label; when narrow, only the icon.
- **Zone chip flicker fixed** by dropping the JS `ResizeObserver`
  measurement in favour of a pure CSS `@container` swap. No more
  measure → hide-name → chip-shrinks → measure loop.
- **PIR icons enriched** with more room keywords (entrance, living
  room, kitchen, office, bedroom, bath, garage, upstairs, dining,
  garden/terrace) — each PIR now picks a room-flavoured glyph based on
  its name.
- **Electricity tile**: the "Electricity" heading is removed to give
  the house visualization more headroom at the top of the tile.
- **Runtime health-chip removed** (the tile now has no health-row at
  all). The freed row's data landed inside the Home callout instead:
  the P1 lifetime totals now unfold into T1 / T2 tariff splits so
  peak-vs-off-peak usage is visible from the diagram itself.

## 0.2.8

- **Electricity tile refocused on electricity**: the outdoor light switches
  (Loads section) are gone; the tile now shows only monitoring data. The
  P1 utility-meter lifetime totals (Import / Export kWh) moved into the
  Home callout on the house diagram as compact sub-lines. PV 1 / PV 2
  voltage and current now sit inside the PV 1 / PV 2 callouts at the top
  of the diagram instead of the old health-row chips.
- **Icon catalog expanded** with ~100 home-automation glyphs across
  lighting, HVAC, kitchen, laundry, media, network, security, energy,
  outdoor and rooms. Each icon carries search aliases so the picker
  matches on synonyms (e.g. "refrigerator" → fridge, "smoothie" →
  blender).
- **Icon picker gets a search box** in both the add-tile and edit-tile
  flows, using the new shared `IconPicker` component.
- **Custom-tile button layout adapts to its own aspect ratio** via CSS
  container queries: tiny tiles collapse to an icon-only chip with
  state carried by the tile tint; wide (≥ 1.6:1) tiles switch to icon
  left / name+state right; portrait tiles keep the vertical stack with
  the name allowed to wrap.
- **Lights: long-press for dim + colour**. `light.*` entities that
  expose brightness or RGB open a colour-swatch + brightness modal on
  long-press (tap still toggles). Backend `HaStateDto` now carries a
  light-attribute bag (brightness, rgb, colour temp, supported modes).
- **Security zones and PIR sensors get icons**. PIR icons are picked
  from the zone name (Entrance → door, Living room → sofa, Kitchen →
  stove, Office → screen, Bedroom → bed, Garage → garage, Upstairs →
  stairs, Terrace/Garden → tree, …). Other zone kinds keep kind-based
  icons (door / window / fire / gas / glass / water).
- **Zone chip icon-only mode via CSS container queries** — no more
  measurement-loop flicker; the chip collapses to a centred icon under
  ~96 px and enlarges the glyph under ~64 px so a lone sensor still
  fills the square nicely.
- Small-label spacing pass: callouts, energy chips, gate buttons and
  health chips got a bit more room so text doesn't clip in normal
  layouts.

## 0.2.7

- Security tile: gate buttons now always sit on **one horizontal row**
  (`grid-auto-flow: column`) regardless of tile aspect ratio, so
  "Garage / Yard / Gate opener" stay in the same line even on the
  compact default portrait size.
- Panel tightened overall: smaller inner padding / gap / gate icons /
  gate min-height, zone chips lose ~30% padding, section titles drop a
  step in size. Everything fits without scrolling in the default 10×14
  tile.
- Add `pzm_home_dashboard/CHANGELOG.md` so the HAOS add-on Update
  dialog can render release notes and stops complaining about a
  missing changelog.

## 0.2.6

- Security tile becomes a size container. Its Gates / Zones / PIR layout
  now re-flows on the tile's own aspect ratio: portrait stays stacked;
  landscape (≥ 1.3) puts a gate column on the left with Zones over PIR on
  the right; wide (≥ 2.2) drops each section into its own column.

## 0.2.5

- Electricity tile grows a **Loads** section: user-configurable toggle
  chips for outdoor / street lights (Terrace torch, Front torch, Street
  sign, Street lamp, Living RGB by default). Any HA domain works — the
  backend picks the right service. Configured under
  `home_assistant.solar.controls`.
- **Pull-to-refresh** from the top of the viewport. Drag past 80 px and
  release to reload every tile.
- **Fix long-press-to-edit** on button tiles — the inner `<button
  disabled>` was swallowing `pointerdown` on iOS Safari / Firefox. Added
  an explicit ✎ button to each custom tile's edit header as a guaranteed
  tap target, and hardened the editor modal against ghost clicks from the
  touchend that opened it.

## 0.2.4

- Removed the bottom-right **Edit / Done** floating button. Edit mode is
  now reached exclusively through the side menu (Layout → Edit layout).
- **Ghost hamburger**: the top-left menu button is now transparent, no
  border, low opacity — it solidifies on hover / focus so it's still
  discoverable.

## 0.2.3

- **Long-press a custom Button / Number tile** in edit mode to open a
  TileEditor with name, icon (buttons only), delete.
- Drag vs long-press coexist via a 6 px movement threshold: any movement
  cancels the long-press timer.

## 0.2.2

- Custom tiles use CSS container queries so the number / label / icon
  scale with the tile itself instead of the viewport.
- **Sharp corners** across every tile / chip / FAB.
- Number tiles get typed icons: thermometer for temperature, droplet for
  humidity, tank for waste-tank depth, door for binary_sensor contacts.
- Button tiles: `touch-action: manipulation` (no tap delay), active-press
  ring, whole-tile on/off tint for instant readability.
- **Icon picker** on the Add Button flow with 22 curated glyphs.

## 0.2.1

- P1 utility meter block on the Electricity tile: lifetime import /
  export plus T1/T2 tariff breakdown.
- **Starter template of custom tiles** seeded on first empty layout
  (garden hose, torches, street lamp/sign, RGB, outside + greenhouse
  temp/humidity, waste tank, garage door contact). Marker prevents
  re-seeding once the user starts editing.
- Entity picker: live-polled preview of the selected entity's value.
- Security card gates: 2-column, more compact.

## 0.2.0

- Shared, server-backed layout in `/data/layout.json`, streamed to every
  open client via SSE — drag / resize edits persist and sync across
  browsers and add-on restarts.
- **Swipe-in side menu** (edge swipe or hamburger) — Edit / Reset / Add
  tile in one touch-friendly drawer.
- Add-tile flow lists Home Assistant entities from a new
  `/api/ha/entities` endpoint. Two tile kinds: **Button** (switch /
  script / button / cover / light / lock) and **Number** (sensor /
  input_number / counter).
- Grid density doubled from 24 → 48 columns.
- Fixed the electricity background image being blank under HAOS ingress
  — reference moved from CSS to JSX inline style so the URL resolves
  against the document base.

## 0.1.x

- Initial add-on: RTSP → HLS transcoding, Solax electricity card, Eldes
  security panel.
