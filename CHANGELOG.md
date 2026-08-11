# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Broader media list parsing robustness across firmware variants
- Video / GIF push helpers in the manager UI

### Added

- Firmware OTA investigation notes (`docs/protocol/ota-firmware.md`)
- Security research findings (`docs/protocol/security.md`)
- `tools/` helpers: `download-firmware.sh`, `send-ota.sh`, `send-ota-ble.py`, `analyze-firmware.sh`, `unpack-apk.sh`, `probe-ota.mjs`
- Manager **Advanced** tab: OTA package prepare (CDN presets / local ufw), GATT·AE00 probe, JieLi RCSP BLE flash, legacy probes, USB/risk notes
- FitPro dial31 image push for BJ-1 (skip Baji media / dial-info probes that drop the link)
- Manager: GitHub / Docs / Issues links; device glance strip (DIS model/FW/HW + battery)
- GATT Device Information reads so FW/model show when Baji `DEVICE_INFO` is absent (e.g. BJ-1)

### Changed

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
