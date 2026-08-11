# Stage 0 — AC707N SDK / flash toolchain gate

Hard gate for on-device clean-room firmware (see plan: without SDK, bare-metal rewrite is usually not worth it).

## Gate status (this host)

| Item | Status | Notes |
|------|--------|-------|
| JieLi **AC707N watch SDK** tree | **MISSING** | No `AC707N_*` / `JL707_watch` SDK under `/opt`, `/root`, or the repo |
| Official flash / ISD download tools | **MISSING** | No `isd_download` / vendor GUI present |
| Stock UFW / `app.bin` artifacts | **Present** | `research/firmware/` + unpacked via `tools/analyze-firmware.sh` |
| UFW unpack (`jl-misctools`) | **Available** | Cloned on demand to `/tmp/jl-misctools` by analyze script |
| BLE OTA helper (`openwearota`) | **Optional** | `tools/send-ota-ble.py` — alpha; AC707N best-effort |
| Host BLE (capture / test) | **Available** | BlueZ + `tools/capture-dial-info.py` (bleak venv) |

**Verdict: GATE CLOSED for flashing custom on-device images.** Protocol RE, host client work, and a portable dial31 reference implementation may proceed; linking a real badge binary requires partner/official SDK + matching `isd_config` download path.

## What “SDK access” means

Obtain (NDA / partner / board package):

1. **AC707N-WATCH-SDK** lineage matching stock string `AC707N_V1.0.0-@20250403-$14f6057c` (or newer compatible).
2. Board support: LCD table for the 360×360 panel, **CST816D** touch, SPI NOR ~4 MiB, charge/PMU.
3. Flash toolchain that consumes the same layout as stock UFW (`uboot.boot`, `isd_config.ini`, `app.bin`, `p11_code.bin`, regions `VM` / `MODE` / …).
4. Keep **stock OTA** (`tools/send-ota.sh` / tomato zip) as recovery until a custom image boots.

## Checklist (operator)

- [ ] SDK tarball / git checkout available on build machine
- [ ] Hello-world project builds `app.bin` (or SDK equivalent)
- [ ] Download tool flashes and badge returns to BLE advertising
- [ ] Stock UFW can still be restored via OTA or wired download
- [ ] Document SDK path in `firmware/ac707n-open/README.md` (local only; do not commit proprietary trees)

## Until the gate opens

Work stays in:

- `docs/protocol/firmware-contract.md` — host-visible contract
- `firmware/ac707n-open/` — portable C + host simulator (no vendor libs)
- `tools/map-fitpro-dispatch.py` / `tools/capture-dial-info.py` — RE + live oracle

## Related

- [Firmware hardware](../protocol/firmware-hw.md)
- [Firmware OTA](../protocol/ota-firmware.md)
- [Clean-room README](../../firmware/ac707n-open/README.md)
