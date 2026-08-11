# Firmware rewrite track (clean-room AC707N)

Honest scope: **not** recovering stock BJ-1 logic from `app.bin`. Goal is open firmware that speaks the same BLE dial path and grows basic UX.

| Doc / artifact | Purpose |
|----------------|---------|
| [sdk-gate.md](sdk-gate.md) | Stage 0 — SDK / flash tool access (hard gate) |
| [re-fitpro-dispatch.md](re-fitpro-dispatch.md) | Static map of `0x1F`/`0x20` seeds in `app.bin` |
| [dial-info-capture.md](dial-info-capture.md) | Live dial-info procedure + results |
| [stage1-ble.md](stage1-ble.md) | LCD + touch + dial31 bring-up |
| [stage2-ui.md](stage2-ui.md) | Gallery / persistence / battery |
| [captures/](captures/) | JSON captures from badges |
| [firmware-contract.md](../protocol/firmware-contract.md) | **Normative** host-visible FW contract |
| [`firmware/ac707n-open/`](../../firmware/ac707n-open/) | Portable C + host simulator |

## Current status

1. **SDK gate:** closed on this host (no AC707N SDK).
2. **RE dispatch:** static seeds documented; Ghidra optional follow-up on listed offsets.
3. **Dial-info:** capture tool ready; live GATT connect may fail when badge is asleep / phone-connected — see capture notes.
4. **Stage 1 / 2:** scaffold + host self-test; on-device blocked on SDK.
