# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Broader media list parsing robustness across firmware variants
- Confirm AVI (video) dial playback on hardware; tune flags/container if needed

### Fixed

- BJ-1 picture pushes use the reported dial profile. Firmware V32286 reports algorithm 3 and receives a packed BR35 ETC2 resource under dial type 0.
- Dial JPEG path (algorithm 4): encode **baseline JFIF 4:4:4** (APK TurboJPEG / JpegRulesChecker); browser `toBlob` 4:2:0 failed MCU on 360×360
- Dial upgrade status codes mapped to readable errors (e.g. status `4` = charging)

### Added

- **Live viewfinder (remote camera)** — stream the host camera to the badge over the product **`0x27`** realtime-preview path: start/stop, device start-response parsing, per-frame ATT chunking with configurable size, device end-command handling, and a camera-free **test-pattern** mode (`src/js/preview.js`, `src/js/extras.js`, `client.previewStart/SendFrame/Stop`)
- **Device-initiated viewfinder** — start manually or opt into auto-start. The contributor verified BG02 (LJ733_MB_V1.5, V35922, 240×240) with 200 B and 512 B chunks. Viewfinder settings persist locally.
- FitPro detection also matches `BG*` GAP names (e.g. `BG02`), skipping the Baji probe timeout
- **Device MAC (identity address)** — the legacy `0x1A`/`0x0A` response is parsed as the badge's own 6-byte BD_ADDR (the address shown on its screen / QR code, e.g. `AA:BB:CC:DD:EE:FF`) and shown as **BLE MAC** in the identity grid; `0x1A`/`0x0C` is parsed as the name fallback. This differs from the random advertising address the OS may expose
- **Video / GIF push (FitPro dial)** — decode a GIF/WebP/APNG (`ImageDecoder`) or video (`<video>` + canvas) in the browser into frame bitmaps, build an **MJPG AVI** (`src/js/avi.js`) auto-tuned to a size budget (JPEG quality then frame rate), and upload over the existing dial31 path with `dialType 1` (`fileType AVI`, same dial id `5538`). New "Push video / GIF" UI (size / FPS / duration / size-budget). Containers/constants recovered from the SuperBand app (`WatchTheme3Body.setFileType(1)`, `VideoTool`)
- **Dial storage** — query free space with `0x20/4`, use it to constrain the AVI budget, and show storage refusals immediately.
- **Quick actions** — sync time, find, set a step goal, set the user profile, toggle realtime steps, control the remote photo page, find the phone, enter OTA mode, shut down, or factory reset.
- Debug console: product `0x27` preview + legacy settings buttons and builders
- Docs: [`protocol/live-preview.md`](docs/protocol/live-preview.md) and [`protocol/legacy-commands.md`](docs/protocol/legacy-commands.md)
- Clean-room firmware track: `docs/firmware-rewrite/`, `docs/protocol/firmware-contract.md`, portable dial31 scaffold `firmware/ac707n-open/`, `tools/map-fitpro-dispatch.py`, `tools/capture-dial-info.py`
- Advanced dial-info probe downloads a JSON capture on success
- Firmware OTA investigation notes (`docs/protocol/ota-firmware.md`)
- Security research findings (`docs/protocol/security.md`)
- `tools/` helpers: `download-firmware.sh`, `send-ota.sh`, `send-ota-ble.py`, `analyze-firmware.sh`, `unpack-apk.sh`, `probe-ota.mjs`
- Manager **Advanced** tab: OTA package prepare (CDN presets / local ufw), GATT·AE00 probe, JieLi RCSP BLE flash, legacy probes, USB/risk notes
- FitPro dial31 image push for BJ-1 (skip Baji media / dial-info probes that drop the link)
- Manager: GitHub / Docs / Issues links; device glance strip (DIS model/FW/HW + battery)
- GATT Device Information reads so FW/model show when Baji `DEVICE_INFO` is absent (e.g. BJ-1)

### Changed

- Dial upload follows Android **WatchTheme3Tools (`gh3`)** ACKs/**6 ms** pacing; Web chunk = `min(shortPkg||5000, ATT−14)` as **one GATT write per CD frame** (mid-frame ATT splits caused black dial after OK status)
- **Push to all** runs **simultaneous** uploads on every connected badge (parallel GATT streams; aggregated progress)
- Default dial size **360×360**; round mask on by default; push checklist (connected / image / idle)
- Badge picker filters include `BJ*`, `DG*`, `_V*`, mfg `0xAA01`
- Pages deploy also publishes `debug-console/`
- Manager supports **multiple concurrent badges** (add / switch active / disconnect one or all / push to all)
- Firmware hardware analysis: SoC **AC707N**, CST816D TP, SPI NOR map (`docs/protocol/firmware-hw.md`, `tools/analyze-firmware.sh`)

### Changed

- Repository layout: `src/` → `src/`, `webapp/` → `src/debug-console/`, `artifact/` → `artifacts/`, unpack tree under `research/`

## [1.0.0] - 2026-08-11

### Added

- RnD investigation docs for SuperBand / electronic badge BLE (Baji UART protocol)
- Protocol reference under `docs/` (GATT, framing, system info, media, file transfer, commands, examples)
- Web Bluetooth management client in `src/` (Bun): connect, device info, image push, media library
- High-level `SuperBandClient` API (`src/js/client.js`) + dial image prep (`src/js/image.js`)
- Debug console in `src/debug-console/` for raw hex / arbitrary Baji packets
- GitHub Actions: Validate (Bun build) and Pages deploy (static site)
- Production build with `BASE_PATH` for GitHub project Pages, `.nojekyll`, and `404.html`
- Root `README.md` with device listing link and hosted Pages URL
- Device reference: [AliExpress listing](https://es.aliexpress.com/item/1005010799519769.html?aem_p4p_detail=2026081110174310473788308808310000293153&pdp_ext_f=%7B%22order%22%3A%22340%22%2C%22eval%22%3A%221%22%2C%22fromPage%22%3A%22search%22%7D&search_p4p_id=2026081110174310473788308808310000293153_3)

### Changed

- Documentation wording uses “RnD investigation” / “reference client” (not reverse-engineering phrasing)

[Unreleased]: https://github.com/T-REX-XP/superband-web-client-rnd/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/T-REX-XP/superband-web-client-rnd/releases/tag/v1.0.0
