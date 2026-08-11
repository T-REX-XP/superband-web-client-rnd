# SuperBand web client

Custom Web Bluetooth manager for the electronic badge — powered by **Bun**.

## Setup

```bash
cd web
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

Push to `main`/`master` (changes under `web/`) deploys via [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).

The workflow sets `BASE_PATH=/<repo>/` so CSS/JS load correctly on project Pages.

Manual deploy: **Actions → Pages → Run workflow**.

Site URL: `https://<owner>.github.io/<repo>/`

## Layout

| Path | Role |
|------|------|
| `server.ts` | Bun.serve + HTML entry / HMR |
| `build.ts` | Production static build (`BASE_PATH`) |
| `preview.ts` | Serve `dist/` locally |
| `index.html` | Management UI shell |
| `css/app.css` | Theme |
| `js/protocol.js` | Baji codec |
| `js/ble.js` | GATT transport |
| `js/client.js` | `SuperBandClient` API |
| `js/image.js` | Dial crop / JPEG prep |
| `js/app.js` | UI wiring |

Protocol docs: [`../docs/`](../docs/README.md)
