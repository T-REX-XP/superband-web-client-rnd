# Firmware contract (clean-room target)

Host-visible behavior that **open AC707N firmware** must satisfy so the SuperBand web client and Android PicturePush path keep working. Stock `app.bin` is a black-box oracle, not a source tree.

This document is the contract. Expand it when RE or live captures add facts.

## Transport

| Item | Requirement |
|------|-------------|
| GAP name | `BJ-1` / `DG*` compatible (manager heuristic) |
| Mfg data | Optional `0xAA01` device-type badge |
| UART GATT | Service `7E400001-B5A3-F393-E0A9-E50E24DCCA9D`, write `…002`, notify `…003` |
| DIS | Prefer `0x180A` model / FW / HW strings (tomato OTA friendliness) |
| Framing | `CD ‖ lenBE ‖ module ‖ 01 ‖ cmd ‖ payloadLenBE ‖ payload` |

See [GATT](gatt.md), [Framing](framing.md).

## FitPro dial plane (mandatory Stage 1)

| Module | Cmd | Direction | Behavior |
|--------|-----|-----------|----------|
| `0x1F` | `2` Start | host→dev | Accept dial id `5538`, type `0` (RGB565) or `2` (JPEG alg4), flags `0x08`, file size; reply status `1000` |
| `0x1F` | `1` Data | host→dev | `u16BE seq` ‖ chunk ‖ `u32BE byteSum(seq‖chunk)`; reply `1000+seq` |
| `0x1F` | `3` Finish | host→dev | `u32BE byteSum(blob)`; reply `2` on success |
| `0x20` | `1` Status | either | u32BE status codes below |
| `0x20` | `2` Info | host→dev | **Must answer and keep GATT up** (stock BJ-1 often drops — do not copy that bug) |

### Status codes

| Code | Meaning |
|-----:|---------|
| `1000` | Start accepted |
| `1000+n` | Chunk `n` accepted |
| `2` | Upgrade success |
| `1` | Verification failed |
| `3` | Battery too low |
| `4` | Charging — refuse dial upgrade |
| `5`–`9` | Storage / limit / duplicate / id / rate (see [Dial upload](dial-upload.md)) |

### Image payload

| Field | Stage‑1 default |
|-------|-----------------|
| Dimensions | **360×360** (until live dial-info says otherwise) |
| Algorithm | **0** → dial type `0` |
| Encode | Little-endian **RGB565**, row-major |
| Blob | `u32BE(imageLen) ‖ pixels` |
| Chunk hint | `min(shortPkg\|\|5000, ATT−14)` — one CD frame per GATT write on Web Bluetooth |

JPEG type `2` only when dial-info reports algorithm `4` (4:4:4 baseline JFIF).

## Explicit non-goals (Stage 1)

- Bit-identical `app.bin`
- Baji `0x25` media/file modules (optional later)
- Full stock UI / AVI / games
- Transplanting closed BT/GPU/JPEG SDK internals

## Stage 2 surface

| Feature | Contract sketch |
|---------|-----------------|
| Gallery | ≥2 faces; touch swipe changes current; last push becomes current |
| Persistence | Survive reboot (NOR/FS layout of your choosing) |
| Battery | Expose % (GATT `0x180F` and/or UI); block dial push while charging (status `4`) |

## Evidence map

| Fact | Source |
|------|--------|
| SoC / flash / TP | [Firmware hardware](firmware-hw.md) |
| Dial sequence | [Dial upload](dial-upload.md), `src/js/fitpro.js` |
| `app.bin` dispatch seeds | [`docs/firmware-rewrite/re-fitpro-dispatch.md`](../firmware-rewrite/re-fitpro-dispatch.md) |
| Live dial-info | [`docs/firmware-rewrite/captures/`](../firmware-rewrite/captures/) |
| SDK gate | [`docs/firmware-rewrite/sdk-gate.md`](../firmware-rewrite/sdk-gate.md) |
| Reference implementation | [`firmware/ac707n-open/`](../../firmware/ac707n-open/) |

## Compliance test (host)

1. `python3 firmware/ac707n-open/host/dial31_sim.py --self-test`
2. Against a device (stock or open FW): push RGB565 via manager **Push to active**; expect status `2` and a visible face.
3. Opt-in dial-info: Advanced → dial-info; open FW must respond without disconnect.
