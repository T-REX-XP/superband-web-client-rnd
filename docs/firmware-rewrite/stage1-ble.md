# Stage 1 — BLE dial31 + display bring-up

Blocked on [SDK gate](sdk-gate.md). Portable logic lives in [`firmware/ac707n-open/`](../../firmware/ac707n-open/).

## Checklist

- [ ] SDK hello-world: LCD backlight + 360×360 framebuffer clear/fill
- [ ] CST816D IRQ / touch coords
- [ ] BLE advertise as `BJ-1`, UART GATT `7E40…` notify+write
- [ ] Wire UART RX → `fitpro_rx_byte` → `dial31_on_frame`
- [ ] Status TX → notify `7E400003`
- [ ] On status `2`: parse blob `u32BE len ‖ RGB565`, blit to FB
- [ ] Dial-info (`0x20`/`2`) answers **without** disconnect
- [ ] Regression: web manager **Push to active** succeeds

## Host validation (available now)

```bash
make -C firmware/ac707n-open test
```

## Acceptance

Matches [firmware-contract.md](../protocol/firmware-contract.md) Stage 1 table; image visible on glass after push.
