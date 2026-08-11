# Research workspace

Local-only material from RnD investigation of the reference Android client and OTA firmware.

| Path | Purpose |
|------|---------|
| `unpacked/` | Extracted `.apks` + jadx sources (gitignored, large) |
| `firmware/` | Downloaded OTA zips / `app.ufw` (gitignored) |

Populate with:

```bash
./tools/unpack-apk.sh
./tools/download-firmware.sh --preset all
```

See [tools/README.md](../tools/README.md), [docs/rnd-investigation.md](../docs/rnd-investigation.md), and the clean-room track in [docs/firmware-rewrite/](../docs/firmware-rewrite/) + [`firmware/ac707n-open/`](../firmware/ac707n-open/).
