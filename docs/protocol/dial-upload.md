# FitPro dial upload (WatchTheme3 / module `0x1F`)

BJ-1 and related LJ733 SuperBand badges **do not** implement Baji media/file transfer (`productId 0x25`). Picture push in the Android app uses the FitPro **watch-theme** path (`WatchTheme3Tools` / `qm2`).

Sending Baji `MEDIA_*` or `FILE_TRANSFER` frames to these devices often times out and can **drop the GATT link**.

## Detection

| Probe | BJ-1 / FitPro-only | Baji badge |
|-------|--------------------|------------|
| GAP name `BJ*` / `DG*` / `BG*` / `*BadgeOK*` | treat as FitPro immediately | — |
| Legacy pair `CD … 12 01 0A …` | `0xDC` ack | often `0xDC` too |
| Legacy `0x1A` D(10)/D(12)/D(28) | best-effort handshake | same |
| Baji `DEVICE_INFO_REQUEST` | **skip** on BJ/DG (timeout only) | `DEVICE_INFO_RESPONSE` |
| FitPro dial info `CD … 20 01 02` | Read on BJ-1 and BG-series badges | Skip |

The manager skips Baji traffic on FitPro badges. BJ-1 and BG-series picture uploads require a dial-info response, which can span notifications.

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
| `4` | JPEG (TurboJPEG q≈50, **4:4:4**) | `2` |
| `3` | JieLi `BmpConvert` mode 6, BR35 `RU50` (ETC2 RGBA8 or RGB565+alpha RLE) | `0` |
| `0` / other | JieLi `BmpConvert` mode 1, BR28 `RU30` (RGB565 RLE) | `0` |

The physical BJ-1 with firmware **V32286** reported **360×360**, algorithm **3**, screen grade **0**, and logical short-packet size **25,000**. The response arrived as two 20-byte notifications. The manager uses the reported dimensions and selects the converter by algorithm.

### Upgrade status (`0x20` / cmd `1`)

Request polls; response payload is **u32BE status**:

| Code | Meaning (Android `WatchThemeTransferManager`) |
|------|---------|
| `1000` | Start accepted — send chunk seq 1 |
| `1000 + n` | Chunk `n` accepted — send next (or finish) |
| `100000000 + N` | **Out of storage** — band `{1e8, 2e8}`, value `<1><0><freeBytes>`; SDK maps to `ERROR_MEMORY_LESS` (1010) with `N` bytes available |
| `2` | Upgrade success |
| `1` | Verification failed |
| `3` | Battery too low |
| `4` | **Charging** — firmware rejects dial upgrade while powered |
| `5` | Insufficient storage |
| `6` | Theme count limit exceeded |
| `7` | Duplicate upgrade |
| `8` | Theme id not found |
| `9` | Upgrade too frequent |

> The `1000…` and `100000000…` bands are the ones the badge actually uses during an upload; the `1`–`9` codes arrive as terminal results. Observed on `BG02`: a video whose blob exceeded free space was refused with `06 01 E4 AC` = `100786348` = "1010, **786 348 B free**".

## Payload formats

### Packed JieLi resources (dial type 0)

The old client sent `width × height × 2` bytes of little-endian RGB565. Android's non-JPEG path sends a packed resource with a `0x450`-byte header and separate descriptor and payload CRC-16/XMODEM values.

- **BR35** (`RU50`, descriptor type `0x00900001`) uses 16-byte ETC2 RGBA8 blocks in row-major block order. The browser composites an opaque image and uses ETC1-compatible color blocks with constant EAC alpha. A 360×360 image has 129,600 payload bytes and 130,704 resource bytes. Android mode 6 may emit a different RLE subtype for unusually compressible images.
- **BR28** (`RU30`, descriptor type `0x24010000`) contains a row directory and per-row RLE over big-endian RGB565 pixel words. Browser output matches SuperBand's ARMv7 mode‑1 converter byte for byte on three retained test vectors.

Both resources are wrapped as `u32BE(resourceLen) ‖ resource`. An upgrade status reports transfer acceptance. Display and reboot behavior need hardware verification.

### JPEG rules (algorithm `4` only)

Firmware / app `JpegRulesChecker` (+ TurboJPEG `subsample=0`) require:

| Rule | Requirement |
|------|-------------|
| Baseline | SOF0 (`FFC0`), not progressive |
| JFIF | APP0 `JFIF` present |
| Chroma | **4:4:4** (component sampling `0x11` for Y/Cb/Cr) — not browser 4:2:0 |
| MCU | Width/height multiple of **8** (4:4:4). 360×360 fails MCU under 4:2:0 (`%16`) |
| Extra | No ICC APP2 / restart markers preferred |

Browser `canvas.toBlob('image/jpeg')` typically emits **4:2:0 + ICC**. Use `src/js/jpeg444.js` when algorithm is `4`.

### MJPG AVI (video / GIF)

The Android app pushes video/GIF as a **looping MJPG AVI** through the *same* dial path — `WatchTheme3Body.setFileType(1)` (`VideoPushViewModel.uploadVideoWithWatchTheme` → `WatchThemeTransferManager.buildWatchTheme3BodyForVideo`). GIF/MP4/MOV/WMV/FLV/MKV are re-encoded to AVI first (`com.jieli.lib.video.tool.VideoTool`, FFmpegKit) before upload.

| Field | Value |
|-------|-------|
| Start `dialType` byte | **`1`** = AVI (vs `0` RGB565 / `2` JPEG) |
| dialId | **`5538`** — the *same* id the app uses for picture push (`R2.styleable.KeyTrigger_triggerId`) |
| File blob | identical wrapper: `u32BE(aviLen) ‖ aviBytes` |
| Sequence | identical `start(2) → data(1) → finish(3)` (chunk ACK flow unchanged) |

Container is a standard **RIFF/AVI**, `vids`/`MJPG`: an `avih` main header, `strl` (`strh` handler `MJPG` + `strf` BITMAPINFOHEADER), a `movi` list of `00dc` chunks (one raw JPEG each), and an `idx1` index. `src/js/avi.js` builds it from decoded frames; `src/js/video.js` decodes GIF/WebP/APNG (`ImageDecoder`) and video (`<video>` + canvas) into JPEG frames.

The badge CPU is a **JieLi AC7076** ("7076 low power") — the same e-badge class as `samascience/ebadge` (BW03 / AC7076A) and the E01 units, whose firmware accepts **baseline JFIF stills or MJPEG-in-AVI**. That corroborates the container choice.

**Storage is the practical limit:** these badges often have little dial space free, and a dial that exceeds it is **refused at the start** with the `1e8`-band status (no `1000` ACK). The exact free space can be queried with **`0x20`/cmd `4`** (`getDialWatchRemainSpace` → `CD 00 05 20 01 04 00 00`; reply is the byte count). The manager queries it before a video push, clamps its *size budget* to it, and auto-tunes JPEG quality then frame rate (`fitAvi`). On `BG02`, four refusals decoded to a **~106 KB** free figure that barely moved — i.e. the badge was nearly full, and the "free" byte count in the status is unreliable (it tracks the file size), so the explicit `0x20`/`4` query is preferred.

Whether the badge firmware *plays* an AVI dial is the open question: the protocol slots and the app code path exist, but it has not yet been confirmed on hardware.

Badge capacity (AliExpress listing for the LJ733 / `BG02`): 1.5″ **240×240** panel, **≈50 images**, **3 videos (each under 5 s)** and GIFs. Exceeding the video slots is expected to surface as the firmware's **status 6** ("theme count limit exceeded").

## Upload sequence (custom background)

Matches SuperBand `PicturePush` → `WatchThemeTransferManager` → `gh3` for a single custom background:

1. Build file blob: `u32BE(partLen) ‖ partBytes` (packed resource, JPEG or AVI)
2. **Start** `0x1F` / cmd `2` with payload:
   - `u32BE dialId` — app uses **`5538`** for processed picture push (and for video)
   - `u8 dialType` — `0` packed resource / `1` AVI video / `2` JPEG
   - `u8 flags` — `0x08` = custom-background only (bit pack from SDK `ks1.a`)
   - `RGB` 3 bytes (usually `00 00 00`)
   - `u32BE fileSize` — blob length
   - style trailer `00 00 00 00` when no mix styles
3. Wait status **`1000`** (strict — fail on 15 s timeout)
4. **Data** `0x1F` / cmd `1`: `u16BE seq` ‖ chunk ‖ `u32BE byteSum(seq‖chunk)`  
   Seq is **1-based**. Android uses `shortPkg||5000` and may ATT-stream one large CD frame. **Web Bluetooth sends each CD frame in a single GATT write** (splitting mid-frame caused BJ-1 to ACK then show a **black** dial). Chunk = `min(shortPkg||5000, maxWrite−14)` ≈ **498 B** at MTU 512, with **6 ms** pacing.
5. After each chunk, wait status **`1000 + seq`** (strict). On slow ACK, poll `0x20`/cmd `1` (not dial-info cmd `2`).
6. **Finish** `0x1F` / cmd `3`: `u32BE byteSum(entire blob)`
7. Wait status **`2`**

The 360×360 BR35 ETC2 resource takes **263** data frames at 498 bytes per chunk.

### BJ-1 evidence

- The vendor V32286 archive has SHA‑256 `ec0785f8264bab9ff578e87ac8a16bd47c8c514bdaa756bad64c6f139c5320c2` (REA archive evidence `ev_1bc8e56cd765e59e8f81c8cf9a41ccce577a49d15f5c827d52df7339b5ac3b3b`). The extracted AC707N `app.bin` has SHA‑256 `ce69a7a6d595a4e2c188c9f776e301f2a6ce065f4de1a802b8b3ffe2f98b250e`. The firmware string map alone does not identify the codec selected by a running badge.
- SuperBand 2.1.25 selects converter mode 6 when algorithm is 3 (REA `ev_a919c16e1c9517b9e003e617bd2101852322667bc19af90de6f23cc6cba3808d`). In the ARMv7 `libjl_bmp_convert.so` split, JNI `bmpConvert` dispatches to `br35_png_to_res_path` with format 2. Offline emulation of `br35_png_to_res` reproduced both the RLE and ETC2 variants. An independent ETC2 decoder decoded the native and browser blocks.
- Live read-only GATT on V32286 confirmed the profile, ATT MTU 517, and 1,384,448 bytes of available dial storage. The first transfer attempt returned status 4 (charging) at START, before any DATA.

## Web client

| Module | Role |
|--------|------|
| `src/js/fitpro.js` | FitPro builders + dial-info parse |
| `src/js/client.js` | `transferDialFile()` when `protocolMode !== 'baji'` |
| `src/js/avi.js` | MJPG AVI (RIFF) container builder for video dials |
| `src/js/video.js` | GIF/WebP/APNG + video → JPEG frames |

## Related

- [Framing](framing.md)
- [System info](system-info.md) (Baji probe behavior)
- [Web console](../web-console.md)
- [Firmware hardware](firmware-hw.md)
- [Firmware contract](firmware-contract.md) (clean-room open FW target)
- [Dial-info capture](../firmware-rewrite/dial-info-capture.md)
