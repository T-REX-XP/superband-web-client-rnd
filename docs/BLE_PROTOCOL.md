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
| Web console | [web-console.md](web-console.md) |
| RE notes | [reverse-engineering.md](reverse-engineering.md) |
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
