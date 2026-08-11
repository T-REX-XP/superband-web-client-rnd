# SuperBand Web Client (RnD)

[![Validate](https://github.com/T-REX-XP/superband-web-client-rnd/actions/workflows/validate.yml/badge.svg)](https://github.com/T-REX-XP/superband-web-client-rnd/actions/workflows/validate.yml)
[![Pages](https://github.com/T-REX-XP/superband-web-client-rnd/actions/workflows/pages.yml/badge.svg)](https://github.com/T-REX-XP/superband-web-client-rnd/actions/workflows/pages.yml)

Unofficial RnD investigation of the **SuperBand / electronic badge** Bluetooth LE protocol (Baji UART), plus a browser client to manage the device.

| Piece | Path | Purpose |
|-------|------|---------|
| Application sources | [`src/`](src/) | Bun Web Bluetooth manager + debug console |
| Protocol docs | [`docs/`](docs/) | GATT, framing, media, file transfer, OTA |
| Tools | [`tools/`](tools/) | Download firmware, unpack APK, probe OTA catalog |
| Artifacts | [`artifacts/`](artifacts/) | Local APKs (gitignored) |
| Research | [`research/`](research/) | Unpacked client + firmware zips (gitignored) |

Derived from SuperBand app `com.legend.smartwatch.electronicbadge.android` **2.1.25**. Not affiliated with the device vendor or app publisher.

Changelog: [CHANGELOG.md](CHANGELOG.md)

## Repository layout

```
.
├── src/                   # All application sources
│   ├── js/ css/ …         # Primary Web Bluetooth manager (Bun)
│   └── debug-console/     # Low-level protocol console
├── tools/                 # Firmware download + APK unpack helpers
├── docs/                  # Protocol + usage documentation
├── artifacts/             # Local APK bundles (not committed)
├── research/              # Unpacked/jadx + firmware (not committed)
└── .github/workflows/     # Validate + GitHub Pages
```

## Device

Hardware under test / target product listing:

**[SuperBand electronic badge on AliExpress](https://es.aliexpress.com/item/1005010799519769.html?aem_p4p_detail=2026081110174310473788308808310000293153&pdp_ext_f=%7B%22order%22%3A%22340%22%2C%22eval%22%3A%221%22%2C%22fromPage%22%3A%22search%22%7D&search_p4p_id=2026081110174310473788308808310000293153_3)**

Typical discovery hints from the reference client:

- Manufacturer company ID `0xAA01`
- Device type `3` (electronic badge)
- Name pattern `_V\d+_BadgeOK` (e.g. `Something_V12_BadgeOK`)

## Protocol (short)

- **GATT UART:** service `7E400001-B5A3-F393-E0A9-E50E24DCCA9D`  
  write `…0002` · notify `…0003`
- **Frame:** `CD \| len \| 25 01 \| module \| bodyLen \| cmd \| payload` (big-endian)
- **Modules:** `0x01` file transfer · `0x02` media · `0x03` system info
- **Upload:** allocate media ID → `TRANSFER_START` → 200-byte `FILE_DATA` chunks → CRC32 → verify

Full write-up: [docs/README.md](docs/README.md) · cheat sheet: [docs/BLE_PROTOCOL.md](docs/BLE_PROTOCOL.md)

---

## Web Bluetooth client

Chrome / Edge only. Prefer the hosted GitHub Pages build (HTTPS is required for Web Bluetooth):

**[https://t-rex-xp.github.io/superband-web-client-rnd/](https://t-rex-xp.github.io/superband-web-client-rnd/)**

### Features

- Connect badge (filtered) or any BLE device
- Device info + battery
- Push image (crop to dial size, JPEG, chunked Baji transfer)
- Media ID allocate / list / delete
- Activity / wire log

### Run locally

Requires [Bun](https://bun.sh).

```bash
cd src
bun install
bun run dev
# → http://localhost:8787
```

Production build / Pages-shaped preview:

```bash
cd src
bun run build
bun run preview:dist
# → http://localhost:8788

BASE_PATH=/superband-web-client-rnd/ bun run build
```

More: [src/README.md](src/README.md) · [docs/web-console.md](docs/web-console.md)

---

## Debug console

Low-level console (raw hex, arbitrary Baji packets):

```bash
cd src/debug-console
python3 -m http.server 8765
# → http://localhost:8765
```

---

## Tools (firmware / APK)

```bash
./tools/download-firmware.sh --preset all          # DG01 + BJ-1 SuperBand zips
./tools/download-firmware.sh --preset bj1          # BJ-1 package
./tools/unpack-apk.sh                              # artifacts/*.apks → research/unpacked/
bun tools/probe-ota.mjs --name BJ-1 --version V32172
```

Details: [tools/README.md](tools/README.md) · [Firmware OTA](docs/protocol/ota-firmware.md)

## Documentation

| Doc | Description |
|-----|-------------|
| [Getting started](docs/getting-started.md) | Layout, Bun, connect a badge |
| [Tools](tools/README.md) | Firmware download + APK unpack |
| [Protocol overview](docs/protocol/overview.md) | Architecture |
| [GATT](docs/protocol/gatt.md) | UUIDs / TX / RX |
| [Framing](docs/protocol/framing.md) | Packet layout |
| [File transfer](docs/protocol/file-transfer.md) | Chunked upload + CRC32 |
| [Media](docs/protocol/media.md) | IDs, list, delete |
| [Firmware OTA](docs/protocol/ota-firmware.md) | JieLi OTA catalog + zip URLs |
| [Commands](docs/protocol/commands.md) | Opcode tables |
| [RnD investigation](docs/rnd-investigation.md) | Reference client notes |

---

## GitHub Actions

| Workflow | Purpose |
|----------|---------|
| [Validate](.github/workflows/validate.yml) | Bun install + production build check |
| [Pages](.github/workflows/pages.yml) | Build `src/` and deploy to GitHub Pages |

Enable **Settings → Pages → Source: GitHub Actions** before the first deploy.  
Manual deploy: **Actions → Pages → Run workflow**.

---

## Disclaimer

This project is for research and interoperability. Use at your own risk. The AliExpress link is a convenience reference to the hardware form-factor under investigation; product availability and firmware may differ.
