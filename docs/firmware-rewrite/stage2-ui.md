# Stage 2 — Badge UX core

Depends on Stage 1 bring-up. Stubs: `firmware/ac707n-open/src/ui_gallery.c`, `ui_battery.c`.

## Checklist

- [ ] Multi-page gallery (swipe via CST816D)
- [ ] Persist faces in NOR/FS (custom layout OK)
- [ ] Last successful dial push becomes current face
- [ ] Battery % UI + GATT `0x180F` when easy
- [ ] Dial upgrade rejected while charging (status `4`)
- [ ] Optional: reuse extracted stock tones/UI art as assets only

## Non-goals

Video AVI dials, stock OTA parity, APK-side games/PTT — later / optional.
