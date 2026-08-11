# AC707N open firmware scaffold (clean-room)

Portable Stage‑1 / Stage‑2 skeleton for a **protocol-compatible** SuperBand badge firmware on JieLi **AC707N**.

This is **not** a decompile of stock `app.bin`. It reimplements the host-visible contract in [`docs/protocol/firmware-contract.md`](../../docs/protocol/firmware-contract.md) so the existing web client (`src/js/fitpro.js`) can push dial images.

## Status

| Stage | Goal | State |
|-------|------|-------|
| 0 | SDK + flash toolchain | **Blocked** — see [`docs/firmware-rewrite/sdk-gate.md`](../../docs/firmware-rewrite/sdk-gate.md) |
| 1 | LCD + touch + BLE dial31 accept | **Host simulator + portable C** (link against SDK when available) |
| 2 | Gallery / persistence / battery UI | **Spec + stubs** in `src/ui_*` |

## Layout

```
firmware/ac707n-open/
  include/fitpro_dial.h   # Frame + dial31 API
  src/fitpro_frame.c      # CD framing / byte-sum
  src/dial31.c            # Start / chunk / finish / status machine
  src/ui_gallery.c        # Stage-2 stub: multi-page faces
  src/ui_battery.c        # Stage-2 stub: charge / battery
  host/dial31_sim.py      # Pure-Python acceptor for web-client fuzz / unit tests
  Makefile                # host tests only (no SDK link)
```

## Host simulator (no SDK)

```bash
python3 firmware/ac707n-open/host/dial31_sim.py --self-test
# Optional: stdio hex session for manual frames
python3 firmware/ac707n-open/host/dial31_sim.py --stdio
```

## SDK integration (when gate opens)

1. Create an AC707N-WATCH-SDK project (board: 360×360 LCD, CST816D, SPI NOR).
2. Advertise GAP name `BJ-1` (or `DG01`) and expose UART GATT `7E400001` / `…002` / `…003`.
3. On UART RX, feed bytes to `fitpro_rx_byte` / `dial31_on_frame` (this tree).
4. On status emit, notify `7E400003` with the built `0x20` status frame.
5. On successful finish: blit RGB565 (dial type `0`) into the framebuffer; persist under your NOR layout.
6. Keep stock OTA recovery until proven.

Do **not** commit proprietary SDK sources into this repo.

## Compatibility target

- Dial upload sequence in [`docs/protocol/dial-upload.md`](../../docs/protocol/dial-upload.md)
- Default image path: **RGB565 LE**, dial type `0`, dial id `5538`, flags `0x08`
- Status codes: `1000`, `1000+seq`, `2`, and errors `1`/`3`–`9`
- Optional dial-info (`0x20`/`2`) **must not drop GATT** (stock BJ-1 bug to avoid)

## Related

- [`docs/firmware-rewrite/README.md`](../../docs/firmware-rewrite/README.md)
- [`tools/map-fitpro-dispatch.py`](../../tools/map-fitpro-dispatch.py)
- [`tools/capture-dial-info.py`](../../tools/capture-dial-info.py)
