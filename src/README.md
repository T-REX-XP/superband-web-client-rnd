# `src/` — application sources

All runnable client code lives here.

| Path | Purpose |
|------|---------|
| `index.html`, `js/`, `css/`, `*.ts` | Primary Web Bluetooth manager (Bun) |
| [`debug-console/`](debug-console/) | Low-level protocol probe |

## Manager setup

```bash
cd src
bun install
bun run dev          # http://localhost:8787
bun run build        # → dist/
bun run preview:dist # http://localhost:8788
```

GitHub Pages build uses `BASE_PATH=/<repo>/` (set in CI).

## Layout (manager)

| Path | Role |
|------|------|
| `server.ts` | Bun.serve + HTML entry / HMR |
| `build.ts` | Production static build (`BASE_PATH`) |
| `preview.ts` | Serve `dist/` locally |
| `js/protocol.js` | Baji codec |
| `js/ble.js` | GATT transport |
| `js/client.js` | `SuperBandClient` API |
| `js/image.js` | Dial crop / JPEG prep |
| `js/app.js` | UI wiring |

Protocol docs: [`../docs/`](../docs/README.md)
