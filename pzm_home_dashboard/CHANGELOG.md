# Changelog

All notable changes to the **PZM Home Dashboard** add-on are listed here.
The format follows Home Assistant's convention: the newest release comes first
and version headers match the `version:` field in `config.yaml`.

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
