# Debug console

Low-level Web Bluetooth probe (raw hex, arbitrary Baji packets).

Lives under `src/` with the rest of the application sources.

**Docs:** [`../../docs/`](../../docs/README.md)

## Run

```bash
cd src/debug-console
python3 -m http.server 8765
```

Open http://localhost:8765 (Chrome / Edge).

Primary manager: [`../`](../) (`bun run dev`).
