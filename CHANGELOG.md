# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Broader media list parsing robustness across firmware variants
- Video / GIF push helpers in the manager UI

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
