# BLE protocol (canonical index)

This file is the short entry point for the SuperBand / Baji BLE protocol. **Full documentation lives in the docs tree:**

| Topic | Document |
|-------|----------|
| Overview | [protocol/overview.md](protocol/overview.md) |
| Discovery | [protocol/discovery.md](protocol/discovery.md) |
| GATT | [protocol/gatt.md](protocol/gatt.md) |
| Framing | [protocol/framing.md](protocol/framing.md) |
| System info | [protocol/system-info.md](protocol/system-info.md) |
| Media | [protocol/media.md](protocol/media.md) |
| File transfer | [protocol/file-transfer.md](protocol/file-transfer.md) |
| Command tables | [protocol/commands.md](protocol/commands.md) |
| Hex examples | [protocol/examples.md](protocol/examples.md) |
| Dial upload (FitPro) | [protocol/dial-upload.md](protocol/dial-upload.md) |
| Legacy commands (FitPro) | [protocol/legacy-commands.md](protocol/legacy-commands.md) |
| Live viewfinder (`0x27`) | [protocol/live-preview.md](protocol/live-preview.md) |
| Firmware OTA | [protocol/ota-firmware.md](protocol/ota-firmware.md) |
| Security research | [protocol/security.md](protocol/security.md) |
| Web console | [web-console.md](web-console.md) |
| RnD notes | [rnd-investigation.md](rnd-investigation.md) |
| Docs home | [README.md](README.md) |

---

## One-page cheat sheet

**Transport**

| Role | UUID |
|------|------|
| Service | `7E400001-B5A3-F393-E0A9-E50E24DCCA9D` |
| Write | `7E400002-B5A3-F393-E0A9-E50E24DCCA9D` |
| Notify | `7E400003-B5A3-F393-E0A9-E50E24DCCA9D` |

**Frame**

```
CD | u16BE(payloadLen+6) | 25 | 01 | module | u16BE(payloadLen+1) | cmd | payload
```

**Modules:** `01` file · `02` media · `03` system  

**Discovery:** company `0xAA01`, type `3`, name `_V\d+_BadgeOK$`  

**Pair:** `CD 00 06 12 01 0A 00 01 02`  

**Upload:** media ID → `TRANSFER_START` TLV → `FILE_DATA`×200 B → `TRANSFER_COMPLETE`+CRC32 → verify  

**CRC32:** IEEE / `java.util.zip.CRC32` over full file.

**Legacy (FitPro) frame** — modules `0x12`/`0x15`/`0x1C`/`0x1D`, `0x1F`/`0x20`, `0x27`:

```
CD | u16BE(len-3) | module | 01 | key | u16BE(payloadLen) | payload
```

**Quick settings:** sync time `CD 00 09 12 01 01 00 04 <u32>` · find `CD 00 06 12 01 0B 00 01 01` · reset `CD 00 02 1D 01` — see [legacy-commands](protocol/legacy-commands.md).

**Live viewfinder (`0x27`):**

```
start   CD 00 05 27 01 00 00 00 00
resp    CD .. .. 27 01 00 00 05 <st> <w:u16BE> <h:u16BE>
frame   AA BB CC DD EE FF | u32BE(jpegLen) | <jpeg> | FF EE DD CC BB AA
stop    AA BB CC DD EE FF 00 00 00 00 FF EE DD CC BB AA
```

See [live-preview](protocol/live-preview.md). Default 240×296, ~10 fps.
