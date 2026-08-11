# Web clients

Two frontends share the same Baji protocol implementation ideas:

| App | Path | Audience |
|-----|------|----------|
| **Manager** (primary) | [`../src/`](../src/) | Day-to-day badge management |
| **Debug console** | [`../webapp/`](../webapp/) | Raw frames, hex, protocol probing |

---

## Manager (`src/`)

### Run

```bash
cd /opt/superband/src
bun install
bun run dev
```

Open http://localhost:8787 (Chrome / Edge). Uses Bun’s HTML bundler + HMR (`server.ts`).

### Features

| Area | Actions |
|------|---------|
| Hero | Connect / disconnect, Bluetooth readiness |
| Device | Name, firmware, protocol, battery, storage; refresh; re-pair |
| Push image | Dial preview, crop to WxH (default 320×384), JPEG, Baji upload |
| Media library | Allocate ID, list, delete |
| Activity | TX/RX and status log |

### Architecture

| Module | Role |
|--------|------|
| `js/protocol.js` | Frame codec, CRC32, command builders |
| `js/ble.js` | Web Bluetooth GATT UART |
| `js/client.js` | `SuperBandClient` — connect, info, media, transfer |
| `js/image.js` | Cover-crop + JPEG encode for dial size |
| `js/app.js` | UI bindings |

### Image pipeline

1. User picks image  
2. Cover-crop to dial width×height (optional round mask)  
3. JPEG quality ~0.5 (matches app TurboJPEG ~50)  
4. `allocateMediaId` (optional) → `transferFile` chunks of 200 B  

---

## Debug console (`webapp/`)

```bash
cd /opt/superband/webapp
python3 -m http.server 8765
```

Use for raw hex writes, arbitrary module/command packets, and verbose wire inspection. See earlier console tabs: Control / Transfer / Raw / Protocol.

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Web Bluetooth unavailable | Chromium + `localhost` or HTTPS |
| Empty picker | **Other device** / wake badge / BT permission |
| UART missing | Wrong peripheral; check activity log |
| Push NACK | Free storage; smaller JPEG; see [error codes](protocol/commands.md#error-codes) |
| List empty | Device may omit list or use alternate layout — push still works |
