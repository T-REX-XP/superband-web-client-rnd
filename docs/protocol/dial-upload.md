# FitPro dial upload (WatchTheme3 / module `0x1F`)

BJ-1 and related LJ733 SuperBand badges **do not** implement Baji media/file transfer (`productId 0x25`). Picture push in the Android app uses the FitPro **watch-theme** path (`WatchTheme3Tools` / `qm2`).

Sending Baji `MEDIA_*` or `FILE_TRANSFER` frames to these devices often times out and can **drop the GATT link**.

## Detection

| Probe | BJ-1 / FitPro-only | Baji badge |
|-------|--------------------|------------|
| GAP name `BJ*` / `DG*` / `*BadgeOK*` | treat as FitPro immediately | — |
| Legacy pair `CD … 12 01 0A …` | `0xDC` ack | often `0xDC` too |
| Legacy `0x1A` D(10)/D(12)/D(28) | best-effort handshake | same |
| Baji `DEVICE_INFO_REQUEST` | **skip** on BJ/DG (timeout only) | `DEVICE_INFO_RESPONSE` |
| FitPro dial info `CD … 20 01 02` | **do not auto-send** — drops BJ-1 GATT | may answer |

The manager uses the GAP name heuristic for SuperBand badges, sends legacy `0x1A` probes, and never auto-sends Baji media or dial-info on those devices.

## Framing

Same `0xCD` start marker as Baji; offset 3 is a **module key**, not `0x25`:

```
CD | lenBE | module | 0x01 | cmd | payloadLenBE | payload
```

| Module | Role |
|--------|------|
| `0x1F` (31) | Dial data plane |
| `0x20` (32) | Dial info / upgrade status |

### Dial info (`0x20` / cmd `2`)

Request: `CD 00 05 20 01 02 00 00` (8-byte short frame).

Response payload (parsed like SDK `bluetooth/c.java` `C()`): screen type, grade, **width/height** BE, model strings, **algorithm**, optional `watchThemeShortPkgLenght` (chunk size hint).

| Algorithm | App encode | Dial type byte |
|-----------|------------|----------------|
| `4` | JPEG (TurboJPEG q≈50) | `2` |
| `0` / `3` / other | JieLi `BmpConvert` (native) | `0` |

### Upgrade status (`0x20` / cmd `1`)

Request polls; response payload is **u32BE status**:

| Code | Meaning (Android `WatchThemeTransferManager`) |
|------|---------|
| `1000` | Start accepted — send chunk seq 1 |
| `1000 + n` | Chunk `n` accepted — send next (or finish) |
| `2` | Upgrade success |
| `1` | Verification failed |
| `3` | Battery too low |
| `4` | **Charging** — firmware rejects dial upgrade while powered |
| `5` | Insufficient storage |
| `6` | Theme count limit exceeded |
| `7` | Duplicate upgrade |
| `8` | Theme id not found |
| `9` | Upgrade too frequent |

## JPEG rules (critical)

Firmware / app `JpegRulesChecker` (+ TurboJPEG `subsample=0`) require:

| Rule | Requirement |
|------|-------------|
| Baseline | SOF0 (`FFC0`), not progressive |
| JFIF | APP0 `JFIF` present |
| Chroma | **4:4:4** (component sampling `0x11` for Y/Cb/Cr) — not browser 4:2:0 |
| MCU | Width/height multiple of **8** (4:4:4). 360×360 fails MCU under 4:2:0 (`%16`) |
| Extra | No ICC APP2 / restart markers preferred |

Browser `canvas.toBlob('image/jpeg')` typically emits **4:2:0 + ICC**. Transfer can still return status `2`, but the dial stays **black**. The web client re-encodes with `src/js/jpeg444.js`.

## Upload sequence (custom background JPEG)

Matches SuperBand `PicturePush` → `WatchThemeTransferManager` → `gh3` for a single custom background:

1. Build file blob: `u32BE(imageLen) ‖ jpegBytes`
2. **Start** `0x1F` / cmd `2` with payload:
   - `u32BE dialId` — app uses **`5538`** for processed picture push
   - `u8 dialType` — `2` for JPEG
   - `u8 flags` — `0x08` = custom-background only (bit pack from SDK `ks1.a`)
   - `RGB` 3 bytes (usually `00 00 00`)
   - `u32BE fileSize` — blob length
   - style trailer `00 00 00 00` when no mix styles
3. Wait status **`1000`**
4. **Data** `0x1F` / cmd `1`: `u16BE seq` ‖ chunk ‖ `u32BE byteSum(seq‖chunk)`  
   Seq is **1-based**. Chunk size = `min(deviceShortPkg, 180)` in the web client (ATT-friendly).
5. After each chunk, wait status **`1000 + seq`**
6. **Finish** `0x1F` / cmd `3`: `u32BE byteSum(entire blob)`
7. Wait status **`2`**

Inter-chunk pacing in the app is ~6 ms; the web client writes serially with a short delay.

## Web client

| Module | Role |
|--------|------|
| `src/js/fitpro.js` | FitPro builders + dial-info parse |
| `src/js/client.js` | `transferDialFile()` when `protocolMode !== 'baji'` |

## Related

- [Framing](framing.md)
- [System info](system-info.md) (Baji probe behavior)
- [Web console](../web-console.md)
- [Firmware hardware](firmware-hw.md)
