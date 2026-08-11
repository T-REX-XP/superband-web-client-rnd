# Getting started

## Repository layout

```
.
├── .github/workflows/   # Pages deploy + validate (Bun)
├── artifacts/           # Local APKs (gitignored)
├── docs/                # This documentation
├── src/                 # All application sources
│   ├── …                # Primary Web Bluetooth manager (Bun)
│   └── debug-console/   # Low-level protocol debug console
└── research/unpacked/   # Extracted APK + jadx sources (gitignored)
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
2. Select the badge in the browser picker
3. Review device info / battery on the Device panel
4. Choose an image → preview on the dial → **Push to badge**
5. Optionally refresh the media library

See [Web client](web-console.md) and [File transfer](protocol/file-transfer.md).

### Debug console (optional)

```bash
cd src/debug-console && python3 -m http.server 8765
```

## Unpack the APK (optional)

Already done under `research/unpacked/` when this project was set up. To redo:

```bash
unzip artifacts/SuperBand_2.1.25_apkcube.apks -d research/unpacked/apks
jadx -d research/unpacked/jadx --show-bad-code --no-res research/unpacked/apks/base.apk
```

Key packages from the reference client:

- `com.baji.protocol` — Baji codec and services
- `com.legend.mywatch.sdk…bluetooth` — GATT UART
- `xfkj.fitpro.ui.viewmodels.bluetooth` — scan filters

See [RnD investigation](rnd-investigation.md).

## Browser notes

| Environment | Works? |
|-------------|--------|
| Chrome / Edge on Linux/macOS/Windows (`localhost`) | Yes |
| Chrome on Android (HTTPS or localhost via USB reverse) | Yes |
| Firefox / Safari | No Web Bluetooth (as of this writing) |
| HTTP over LAN IP | Blocked by browser secure-context rules |
