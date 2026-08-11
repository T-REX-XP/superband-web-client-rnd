# Tools

Helper scripts for local RnD (firmware catalog / download, APK unpack). Run from the **repo root**.

| Script | Purpose |
|--------|---------|
| [`download-firmware.sh`](download-firmware.sh) | Probe tomato OTA catalog and/or download known SuperBand zips → `research/firmware/` |
| [`probe-ota.mjs`](probe-ota.mjs) | JSON probe of `config/app` (same check as the Android client) |
| [`unpack-apk.sh`](unpack-apk.sh) | Extract `.apks` → `research/unpacked/apks` and optionally decompile with jadx |

## Prerequisites

- `curl`, `unzip`, `sha256sum` (or `shasum` on macOS)
- [Bun](https://bun.sh) for `probe-ota.mjs` / catalog lookup inside `download-firmware.sh`
- [jadx](https://github.com/skylot/jadx) on `PATH` for decompile (optional)

## Examples

```bash
# Download DG01 + BJ-1 SuperBand packages and unpack app.ufw
./tools/download-firmware.sh --preset all

# BJ-1 only (matches GAP name like "BJ-1")
./tools/download-firmware.sh --preset bj1

# Probe catalog by DIS soft-version key, download if offered
./tools/download-firmware.sh --version V32294 --name BJ-1

# Catalog JSON only
bun tools/probe-ota.mjs --name BJ-1 --version V32172

# Unpack reference APK (+ jadx if installed)
./tools/unpack-apk.sh
./tools/unpack-apk.sh --apks artifacts/SuperBand_2.1.25_apkcube.apks --no-jadx
```

Outputs are gitignored under `research/firmware/` and `research/unpacked/`.

See [Firmware OTA](../docs/protocol/ota-firmware.md) and [RnD investigation](../docs/rnd-investigation.md).
