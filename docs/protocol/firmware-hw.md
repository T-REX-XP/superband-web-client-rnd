# Firmware hardware analysis (LJ733 / SuperBand)

Static analysis of vendor OTA packages for the electronic badge line (`DG01`, `BJ-1`, product family **LJ733**). Artifacts were downloaded via the tomato catalog (see [Firmware OTA](ota-firmware.md)) and unpacked with [jl-misctools](https://github.com/kagaimiq/jl-misctools) `fwunpack_newfw.py`.

## Verdict

| Item | Finding |
|------|---------|
| **SoC** | **JieLi AC707N** (UFW chip name / PID; SDK tag `AC707N_V1.0.0-@20250403-$14f6057c`) |
| Platform branding | `JL707_watch`, `AC707N-demo`, flash/BT stack markers `JL-BR221` / `br22xx` / `BR35` |
| Package format | JieLi **UFW** → flash image (new-fw / BR22+ style) |
| External flash | SPI **NOR**, usable size **`$3FF000` (~4 MiB)**, `NORFLASH_DTR_EN=1` |
| Touch | Driver symbol **`tp_cst816d`** → **Hynitron CST816D** (common round-screen TP) |
| Display path | `lcd_init` / `lcd_backlight` / `gpu_driver` / `jlgpu` / `JLHWJPEG` (panel IC not named in cleartext) |
| Connectivity | Dual-mode BT stack (`DBG_BT_BLE`, `DBG_BT_BREDR`), JieLi OTA (`ble_ota`, `JLOTA`, GATT `AE00` in app) |
| Companion core | `p11_code.bin` (~18 KB) — low-power **P11** image used by AC707N SDK |
| Media | AVI background paths (`bgp_wa%d.avi`), JPEG decode, UI on NOR (`storage/nor_ui`) |

DG01 (`V32399_…_DG01_SUPERBAND`) and BJ-1 (`V32286_…_BJ-1_SUPERBAND`) share the **same** chip, `isd_config.ini`, `cfg_tool.bin`, `p11_code.bin`, and `config.dat`. Application `app.bin` differs (OEM / UI / feature cut) but is the same silicon target.

## UFW / flash map (DG01 V32399)

From unpack of `app.ufw`:

| Field | Value |
|-------|-------|
| Chip name | `AC707N` |
| VID | `0.01` |
| Flash size field | `$3FF000` |
| Chipkey | `$B165` |
| Entry point | `0x0C000100` |
| Top files | `uboot.boot`, `isd_config.ini`, `app_dir_head`, `key_mac`, `otp_cfg` |
| App | `app.bin` ≈ 980 KB |
| Regions | `VM`, `PRCT`, `MODE` (~media), `EXIF`, `BTIF` |
| Resources | `tone_en` (power-on / game tones), `ui_upgrade`, `cfg_tool.bin`, `p11_code.bin`, `stream.bin`, `config.dat` |

Upgrade UI metadata: `upgrade.json` → `"version_id": "W002"`.

### `isd_config.ini` (decoded keys)

| Key | Value / meaning |
|-----|-----------------|
| `SPI` / `4_3_1_0` | SPI NOR timing / mode block |
| `NORFLASH_DTR_EN` | 1 — dual-transfer-rate NOR |
| `NORFLASH_WPS_EN` | 0 |
| `RESET` | `PB07_08_0` — reset pin mux |
| `SD_LATCH_IO` | `CONFIG_SD_LATCH_IO` |

### `cfg_tool.bin` / `config.dat`

- Product strings: `watch`, `AC707N`, `AC707N-demo`, `V1.0.0`, `JL707_watch`, baud-ish `40000`
- IO names: `reset_io`, `pilot_lamp_io`, `power_io`, pins **`PB03`**, **`PC03_1`**
- SDK lineage string also references `jl_sdk_ac697_publish` (shared tooling / config schema, not a second SoC)

## SoC context (public AC707N family)

JieLi positions **AC707N** as a color-screen wearable SoC (watch / badge class): ~288 MHz DSP-class CPU, on-chip SRAM, **2.5D GPU**, JPEG HW, dual-mode Bluetooth, integrated PMU/charge paths. Package/options in the lineup include QFN variants with different internal flash / PSRAM; this badge image is built around **external SPI NOR** (~4 MiB) plus optional **PSRAM** support in the binary (`psram` symbol). Exact AC707x BOM suffix (e.g. A6 vs A7) is **not** printed in the UFW chipname field — only `AC707N`.

## Peripherals inferred from firmware

| Function | Evidence |
|----------|----------|
| Capacitive touch | `tp_cst816d` / `tp_init` |
| LCD + backlight | `lcd_init`, `lcd_backlight` |
| GPU / JPEG | `gpu_driver`, `jlgpu`, `JLHWJPEG`, `jpeg_decode` |
| Video faces | `.avi` / `bgp_wa%d.avi` under virtual FAT / NOR UI |
| Audio tones | `.wtg` assets (`power_on`, `game_ballon`, `game_muyv`) |
| Charge / battery | `batcharge`, `charge` |
| USB | `usb_stack`, USB OTA update images in name table |
| Debug buses | UART0–2, SPI0–2, IIC, USB, BT RF |

Panel glass size (~1.85″ 360×360) comes from product listings / field notes, **not** a cleartext `360x360` string in `app.bin`. Prefer dial dimensions from the live device (Baji dial-info / DIS) when pushing images.

## DG01 vs BJ-1

| | DG01 SuperBand zip | BJ-1 SuperBand zip |
|--|--------------------|--------------------|
| Catalog key | `V32294` → target `V32399` | `V32172` → target `V32286` |
| SoC / isd / p11 / cfg_tool | Identical | Identical |
| `app.bin` | Distinct build (~979 778 B) | Distinct build (~979 721 B) |
| VM / MODE sizes | Larger VM & MODE regions | Smaller VM; MODE starts earlier |

Treat them as **same hardware platform, different OEM firmware cuts**. Do not flash unrelated LJ755/LJ760 watch zips onto these badges.

## How to reproduce

```bash
# Download packages
./tools/download-firmware.sh --preset all

# Analyze / unpack (needs network once for jl-misctools + venv)
./tools/analyze-firmware.sh --preset dg01
./tools/analyze-firmware.sh --preset bj1
```

Outputs land under `research/firmware/analysis/` (gitignored with `research/firmware/`).

## Related

- [Firmware OTA](ota-firmware.md) — download URLs / catalog keys
- [GATT](gatt.md) — UART `7E40…`, JieLi OTA `AE00`
- [RnD investigation](../rnd-investigation.md)
