# Web clients

All application UI sources live under [`../src/`](../src/).

| App | Path | Audience |
|-----|------|----------|
| **Manager** (primary) | [`../src/`](../src/) | Day-to-day badge management |
| **Debug console** | [`../src/debug-console/`](../src/debug-console/) | Raw frames, hex, protocol probing |

Source repository: [T-REX-XP/superband-web-client-rnd](https://github.com/T-REX-XP/superband-web-client-rnd)

---

## Manager (`src/`)

### Run

```bash
cd src
bun install
bun run dev
```

Open http://localhost:8787 (Chrome / Edge). Uses Bun’s HTML bundler + HMR (`server.ts`).

Production static site is published to **GitHub Pages** by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) (Bun build with `BASE_PATH=/<repo>/` → `src/dist` → Pages). Enable **Settings → Pages → Source: GitHub Actions**, then push to `main`/`master` or run the workflow manually.

### Features

| Area | Actions |
|------|---------|
| Hero | Connect / disconnect, Bluetooth readiness, **GitHub / Docs / Issues** links |
| Glance strip | Name, model, firmware, battery, hardware, free storage (while connected) |
| Device | Full DIS + battery + optional Baji storage/protocol; refresh; re-pair |
| Push image | Checklist (connected / image / idle), dial preview, crop to WxH (default **360×360**), round mask on by default, JPEG, Baji upload |
| Media library | Allocate ID, list, delete (auto-refresh attempted after connect / push) |
| Activity | TX/RX and status log |
| Footer | Repo + protocol links, debug console, build meta |

### Device identity sources

| Field | Source |
|-------|--------|
| Name | GAP / picker |
| Model, firmware, hardware, software, manufacturer | GATT **DIS** `0x180A` (`2A24`…`2A29`) |
| Battery | GATT Battery `0x180F` / `2A19` |
| Protocol, free/capacity | Baji `DEVICE_INFO_RESPONSE` (optional — many badges omit this) |

Push and media allocate **do not** require Baji device-info. If only a legacy `0xDC` pair ack arrives (e.g. **BJ-1**), the UI still shows DIS + battery and image push remains available.

### Architecture

| Module | Role |
|--------|------|
| `js/protocol.js` | Frame codec, CRC32, GATT UUIDs, `REPO_URL` |
| `js/ble.js` | Web Bluetooth UART + DIS + battery |
| `js/client.js` | `SuperBandClient` — connect, identity snapshot, media, transfer |
| `js/image.js` | Cover-crop + JPEG encode for dial size |
| `js/app.js` | UI bindings |

### Image pipeline

1. User picks image  
2. Cover-crop to dial width×height (round mask default on)  
3. JPEG quality ~0.5 (matches app TurboJPEG ~50)  
4. `allocateMediaId` (optional) → `transferFile` chunks of 200 B  

---

## Debug console (`src/debug-console/`)

```bash
cd src/debug-console
python3 -m http.server 8765
```

Use for raw hex writes, arbitrary module/command packets, and verbose wire inspection. Linked from the manager footer when both are served from the same origin (local or Pages).

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Web Bluetooth unavailable | Chromium + `localhost` or HTTPS |
| Empty picker | **Other device** / wake badge / BT permission; filters include `BJ*`, `DG*`, `_V*`, mfg `0xAA01` |
| Firmware shows "—" | Badge may omit DIS; check Activity for `DIS:` log line |
| Device info timeout | Normal on some FW — use glance DIS fields; push still works |
| UART missing | Wrong peripheral; check activity log |
| Push NACK | Free storage; smaller JPEG; see [error codes](protocol/commands.md#error-codes) |
| List empty | Device may omit list or use alternate layout — push still works |
