# Live viewfinder / realtime preview (product `0x27`)

The badge can display a **live camera feed** from the phone — the advertised
"remote camera / viewfinder" feature. The host streams JPEG frames to the badge
over the same UART characteristic used by the dial push, using a distinct
**product ID `0x27`** (39).

This was reconstructed from the **SuperBand 1.10.04** Android APK
(`com.legend.mywatch` SDK):

| Source class | Role |
|---|---|
| `realtimepreview/protocol/PreviewConstants` | product id, sentinels, defaults |
| `realtimepreview/protocol/PreviewCommandBuilder` | start / end-response / stop frames |
| `realtimepreview/builder/ImagePacketBuilder` | JPEG frame wrapper |
| `realtimepreview/transport/PreviewSender` | streaming loop, flow control |
| `realtimepreview/image/PreviewImageProcessor` | TurboJPEG (libjpeg-turbo) encode |
| `bluetooth/ReceiveData.k()` | device start-response / end-command parsing |
| `sdk/cameralibray/Camera2Activity` | UI: webcam, `EXTRA_REMOTE_SHUTTER_ON_OPEN` |

> The 2.x ("Baji") line does not document this path; it is separate from the
> Baji media/file modules (`0x25`) and from the FitPro dial push (`0x1F`/`0x20`).

## Constants

| Constant | Value |
|---|---|
| Product / module at frame[3] | `0x27` (39) |
| Frame start marker | `0xCD` |
| Function module at frame[5] | `0x00` start · `0x01` end |
| Default display size | 240 × 296 |
| Default frame rate | ~10 fps (100 ms) |
| JPEG quality | ~0.7 (libjpeg-turbo) |
| Image frame sentinel | `AA BB CC DD EE FF` … `FF EE DD CC BB AA` |

## App → device frames

### Start

```
CD 00 05 27 01 00 00 00 00
```

### End response (acknowledge a device end command)

```
CD 00 06 27 01 01 00 01 <status>      status: 00 = success, 01 = failed
```

### Stop

```
AA BB CC DD EE FF 00 00 00 00 FF EE DD CC BB AA
```

### Image data frame

Raw (no `0xCD` header), written to the UART **write** characteristic
(`7E400002…`) and chunked to the ATT/MTU budget:

```
AA BB CC DD EE FF | u32BE(jpegLen) | <jpeg bytes> | FF EE DD CC BB AA
```

The 4 middle bytes are the **big-endian JPEG byte length**. The Android app
chunked this through `CommandPool` (`getMtu()`-sized writes), i.e. the device
reassembles the sentinel-framed payload across several ATT writes.

## Device → app frames (`0xCD`, product `0x27`)

`frame[5]` is the function module.

### Start response — length ≥ 13 bytes, payload length 5

```
CD <len> 27 01 00 00 05 <status> <width:u16BE> <height:u16BE>
```

| Offset | Field |
|---|---|
| `[5]` | function module = `00` |
| `[6..7]` | payload length = `00 05` |
| `[8]` | status (`00` = success) |
| `[9..10]` | display width (BE u16) |
| `[11..12]` | display height (BE u16) |

On success the app adopts the reported `width × height` and starts streaming.
If no local start was pending, the badge initiated it (Android broadcasts
`DeviceInitiatedPreviewStartEvent`).

### End command — function module `01`, payload length `0` or `1`

```
CD <len> 27 01 01 00 00            (stop, no status)
CD <len> 27 01 01 00 01 <status>   (stop, status; 00 = success)
```

The host stops streaming and replies with the **end response** above. The badge
sends this **when you exit the viewfinder app on the badge**, and the host may
also send the stop itself when the user ends the stream.

## Flow control

Per-**logical**-frame, not per-notify: the Android sender counts the ATT writes
for a frame and moves on when the GATT write callbacks complete (or a 4 s
timeout). Frames are dropped from the head of the local queue if it grows past
~4 while streaming. Target ≈10 fps; the inter-chunk gap was tuned ~3–6 ms.

Frames are **JPEG**, encoded with libjpeg-turbo from the camera feed
(YUV → NV21 → JPEG → scale → re-encode at q≈0.7).

## Minimal sequence

```
app → dev : CD 00 05 27 01 00 00 00 00            (start)
dev → app : CD 00 0A 27 01 00 00 05 00 00 F0 01 28   (ok, 240×296)
app → dev : AA BB CC DD EE FF <len> <jpeg> FF EE DD CC BB AA   (frame 1, chunked)
app → dev : AA BB CC DD EE FF <len> <jpeg> FF EE DD CC BB AA   (frame 2, …)
   … 10 fps …
dev → app : CD 00 07 27 01 01 00 01 00            (end, success)
app → dev : CD 00 06 27 01 01 00 01 00            (end response)
app → dev : AA BB CC DD EE FF 00 00 00 00 FF EE DD CC BB AA   (stop)
```

## Web client notes

The manager UI implements this in [`src/js/preview.js`](../../src/js/preview.js)
(frames) + [`src/js/extras.js`](../../src/js/extras.js) (camera UI), with the
transport in `BadgeSession.previewStart` / `previewSendFrame` / `previewStop`
(`src/js/client.js`).

- Camera comes from `getUserMedia`; `canvas.toBlob('image/jpeg', q)` produces the
  JPEG. A **test pattern** mode draws synthetic frames so the wire path can be
  exercised without a camera.
- **Device-initiated**: when you open the viewfinder on the badge it sends the
  start response itself —
  `CD 0A 27 01 00 00 05 00 <w:u16BE> <h:u16BE>` (e.g. `00 00 f0 00 f0` =
  240×240 on LJ733 / `BG02`). The manager then **auto-starts streaming** without
  sending `PREVIEW_START` (toggle: *Auto-start when the badge requests it*) and
  answers the device end command automatically.
- **Chunk size matters**: Web Bluetooth does not expose the negotiated MTU. The
  manager defaults to 200-byte chunks (lower it if frames stall on firmware with a
  small ATT MTU). **512-byte chunks are verified working on `BG02`** and cut
  fragmentation roughly 2.5× (a 6.1 KB frame → 13 ATT writes vs 32 at 200 B); 512
  is the browser maximum. The chosen FPS / quality / chunk / toggles are
  remembered in `localStorage`.
- Stop the phone app first — it holds the badge's only LE link.

## Verified on hardware

Confirmed working end-to-end with the manager on:

| Field | Value |
|---|---|
| Badge | GAP name `BG02` |
| Hardware | `LJ733_MB_V1.5` (LJ733 / AC707n-class) |
| Firmware | `V35922` |
| Protocol path | FitPro (`BG*` GAP names skip the Baji probe) |

Observed lifecycle:

```
dev → app : cd 00 0a 27 01 00 00 05 00 00 f0 00 f0   device-initiated start, 240×240
app → dev : aa bb cc dd ee ff <len> <jpeg> ff ee dd cc bb aa   frames, ~1–6 KB JPEG
dev → app : cd 00 06 27 01 01 00 01 00                end (user exited the badge app)
app → dev : cd 00 06 27 01 01 00 01 00                end response
app → dev : aa bb cc dd ee ff 00 00 00 00 ff ee dd cc bb aa   stop
```

- **No per-frame ACK is required** — local GATT write completion is sufficient
  flow control (the badge did not notify per frame).
- **Chunk size**: **200 B and 512 B both work**; 512 reduces ATT fragmentation
  (6.1 KB frame → 13 writes at 512 B vs 32 at 200 B).
- The badge reports its size in the (device-initiated) start response; here
  **240×240**.
- Exiting the badge's viewfinder app produces the end command even if the host
  was not streaming; replying with end-response + stop is correct.

## Open questions

- Whether all firmware accepts preview frames on `7E400002`, or a vendor service
  (`0x3802` / `4A02`) on some units (unconfirmed; `BG02` uses the UART write char).
