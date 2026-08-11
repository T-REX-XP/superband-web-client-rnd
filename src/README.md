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
# GitHub project Pages (subdir):
BASE_PATH=/superband-web-client-rnd/ bun run build
```

Static output goes to `dist/` (hashed assets, `.nojekyll`, `404.html`).

Preview the production build:

```bash
bun run build && bun run preview:dist
# → http://localhost:8788
```

## GitHub Pages

Push to `main`/`master` (changes under `src/`) deploys via [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).

The workflow sets `BASE_PATH=/<repo>/` so CSS/JS load correctly on project Pages (not only with a trailing slash).

Manual deploy: **Actions → Pages → Run workflow**.

Repo Settings → Pages → Source must be **GitHub Actions**. Site URL:

`https://<owner>.github.io/<repo>/`

Web Bluetooth requires a secure context — GitHub Pages HTTPS satisfies that.

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
