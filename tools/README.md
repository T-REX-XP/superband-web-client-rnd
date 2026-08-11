# Tools

Helper scripts for local RnD (firmware catalog / download / OTA send, APK unpack). Run from the **repo root**.

| Script | Purpose |
|--------|---------|
| [`download-firmware.sh`](download-firmware.sh) | Probe tomato OTA catalog and/or download known SuperBand zips → `research/firmware/` |
| [`send-ota.sh`](send-ota.sh) | Prepare `app.ufw` and flash over BLE (`AE00`) or print USB forced-update hints |
| [`send-ota-ble.py`](send-ota-ble.py) | BLE scan / AE00 probe / `openwearota` flash helper (used by `send-ota.sh`) |
| [`analyze-firmware.sh`](analyze-firmware.sh) | Unpack JieLi UFW + summarize SoC / peripherals → `research/firmware/analysis/` |
| [`map-fitpro-dispatch.py`](map-fitpro-dispatch.py) | Static FitPro `0x1F`/`0x20` seed map in `app.bin` → `docs/firmware-rewrite/` |
| [`capture-dial-info.py`](capture-dial-info.py) | Live BLE dial-info capture (bleak) → `docs/firmware-rewrite/captures/` |
| [`probe-ota.mjs`](probe-ota.mjs) | JSON probe of `config/app` (same check as the Android client) |
| [`unpack-apk.sh`](unpack-apk.sh) | Extract `.apks` → `research/unpacked/apks` and optionally decompile with jadx |

## Prerequisites

- `curl`, `unzip`, `sha256sum` (or `shasum` on macOS)
- [Bun](https://bun.sh) for `probe-ota.mjs` / catalog lookup
- Python **3.10+** for BLE OTA (`send-ota.sh` creates `tools/.venv-ota` with `bleak` + `openwearota`)
- BlueZ / BLE adapter on Linux (Raspberry Pi OK)
- [jadx](https://github.com/skylot/jadx) on `PATH` for decompile (optional)

## Firmware download

```bash
./tools/download-firmware.sh --preset all
./tools/download-firmware.sh --preset bj1
./tools/download-firmware.sh --version V32294 --name BJ-1
bun tools/probe-ota.mjs --name BJ-1 --version V32172
```

## Send OTA package

```bash
# 1) Resolve zip → app.ufw (BJ-1 / DG01 presets, local zip, or catalog version)
./tools/send-ota.sh --preset bj1 --prepare

# 2) Find the badge
./tools/send-ota.sh --scan

# 3) Confirm JieLi OTA service is present
./tools/send-ota.sh --preset bj1 --probe --address AA:BB:CC:DD:EE:FF

# 4) Flash (prompts for YES; use --yes to skip)
./tools/send-ota.sh --preset bj1 --ble --address AA:BB:CC:DD:EE:FF --probe-first

# USB / UART forced update notes (chipkey $B165)
./tools/send-ota.sh --usb-hint
```

**Warnings**

- Match OEM cut: **BJ-1** vs **DG01** — do not flash LJ755 / LJ760 / random `LJ733B` images.
- BLE flash uses [openwearota](https://pypi.org/project/openwearota/) (alpha; validated mainly on AC695/AC696 — AC707N best-effort).
- Wrong image can brick the device. Read [Security research](../docs/protocol/security.md).

## APK / hardware analysis

```bash
./tools/unpack-apk.sh
./tools/analyze-firmware.sh --preset dg01
./tools/analyze-firmware.sh --preset bj1
```

Outputs are gitignored under `research/firmware/`, `research/unpacked/`, and `tools/.venv-ota/`.

### Firmware rewrite helpers

```bash
./tools/analyze-firmware.sh --preset bj1
python3 tools/map-fitpro-dispatch.py
# bleak venv recommended:
python3 -m venv /tmp/superband-blevenv && /tmp/superband-blevenv/bin/pip install bleak
/tmp/superband-blevenv/bin/python tools/capture-dial-info.py
make -C firmware/ac707n-open test
```

See [Firmware rewrite](../docs/firmware-rewrite/README.md), [Firmware contract](../docs/protocol/firmware-contract.md), [Firmware OTA](../docs/protocol/ota-firmware.md), [Security](../docs/protocol/security.md), [Firmware hardware](../docs/protocol/firmware-hw.md).
