# SuperBand web client

Custom Web Bluetooth manager for the electronic badge — powered by **Bun**.

## Setup

```bash
cd /opt/superband/src
bun install
```

## Develop

```bash
bun run dev
```

Open http://localhost:8787 (override with `PORT=3000 bun run dev`).

Bun serves `index.html` with HMR via `server.ts`.

## Build

```bash
bun run build
```

Static output goes to `dist/`.

## Layout

| Path | Role |
|------|------|
| `server.ts` | Bun.serve + HTML entry / HMR |
| `index.html` | Management UI shell |
| `css/app.css` | Theme |
| `js/protocol.js` | Baji codec |
| `js/ble.js` | GATT transport |
| `js/client.js` | `SuperBandClient` API |
| `js/image.js` | Dial crop / JPEG prep |
| `js/app.js` | UI wiring |

## Features

- Connect badge (filtered) or any BLE device
- Device info + battery
- Push image (crop to dial size, JPEG, chunked Baji transfer)
- Media ID allocate / list / delete
- Activity log

Protocol docs: [`../docs/`](../docs/README.md)
