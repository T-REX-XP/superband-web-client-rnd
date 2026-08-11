# Debug console

Low-level Web Bluetooth probe for the SuperBand electronic badge (raw hex, arbitrary Baji packets).

**Documentation:** [`../../docs/`](../../docs/README.md)

## Quick run

```bash
cd tools/debug-console
python3 -m http.server 8765
```

Open http://localhost:8765 (Chrome / Edge).

For day-to-day device management, use the primary client in [`../../web/`](../../web/).
