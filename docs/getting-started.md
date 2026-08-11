# Getting started

## Repository layout

```
.
├── .github/workflows/   # Pages deploy + validate (Bun)
├── artifacts/           # Local APKs (gitignored)
├── docs/                # This documentation
├── tools/               # Firmware download + APK unpack scripts
├── src/                 # All application sources
│   ├── …                # Primary Web Bluetooth manager (Bun)
│   └── debug-console/   # Low-level protocol debug console
└── research/            # unpacked/ + firmware/ (gitignored)
```

## Prerequisites

- Chromium browser (Chrome or Edge) with Web Bluetooth
- Bluetooth adapter (desktop or Android Chrome)
- Serve the app over **HTTPS** or **`http://localhost`** (required by Web Bluetooth)
- A SuperBand / electronic badge nearby (advertises manufacturer ID `0xAA01`, often named `*_Vn_BadgeOK`)

## Run the management client

Requires [Bun](https://bun.sh).

```bash
cd src
bun install
bun run dev
```

Open [http://localhost:8787](http://localhost:8787).

1. Click **Connect badge** (or **Other device**)
2. Select the badge in the browser picker (`BJ-1`, `DG01`, `*_BadgeOK`, …)
3. Confirm the hero glance strip: name, model, firmware, battery
4. Choose an image → preview on the dial → checklist green → **Push to badge**
5. Optionally refresh the media library

Repo / docs links are in the hero and footer. See [Web client](web-console.md) and [File transfer](protocol/file-transfer.md).

### Debug console (optional)

```bash
cd src/debug-console && python3 -m http.server 8765
```

## Unpack the APK (optional)

Place the SuperBand `.apks` under `artifacts/`, then:

```bash
./tools/unpack-apk.sh
# or: ./tools/unpack-apk.sh --apks artifacts/SuperBand_2.1.25_apkcube.apks --no-jadx
```

This writes `research/unpacked/apks/` and (if `jadx` is on `PATH`) `research/unpacked/jadx/`.

Key packages from the reference client:

- `com.baji.protocol` — Baji codec and services
- `com.legend.mywatch.sdk…bluetooth` — GATT UART
- `xfkj.fitpro.ui.viewmodels.bluetooth` — scan filters

See [RnD investigation](rnd-investigation.md) · [tools/README.md](../tools/README.md).

## Download firmware (optional)

```bash
./tools/download-firmware.sh --preset bj1    # GAP name "BJ-1"
./tools/download-firmware.sh --preset dg01   # DG01 SuperBand
./tools/download-firmware.sh --preset all
# Or probe by DIS soft-version catalog key:
./tools/download-firmware.sh --version V32172 --name BJ-1
```

Zips land in `research/firmware/` (gitignored). See [Firmware OTA](protocol/ota-firmware.md).

## Browser notes

| Environment | Works? |
|-------------|--------|
| Chrome / Edge on Linux/macOS/Windows (`localhost`) | Yes |
| Chrome on Android (HTTPS or localhost via USB reverse) | Yes |
| Firefox / Safari | No Web Bluetooth (as of this writing) |
| HTTP over LAN IP | Blocked by browser secure-context rules |
