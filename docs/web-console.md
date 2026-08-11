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
| Hero | Connect / **add another** / disconnect / disconnect all; GitHub links |
| Tabs | **Manager** (day-to-day) · **Advanced** (OTA / GATT / probes) |
| Device rail | Multiple concurrent badges — click to make active, × to drop one |
| Glance strip | Active badge: name, model, firmware, battery, hardware, free storage |
| Device | Full DIS + battery + optional Baji storage/protocol; refresh; re-pair |
| Push image | **Push to active** / **Push to all**; FitPro dial upload matches Android (`gh3`: 5 KB logical chunks, 6 ms ATT pace, strict ACKs); 360×360; round mask |
| Media library | Allocate ID, list, delete (auto-refresh attempted after connect / push) |
| Advanced · OTA | CDN presets (BJ-1 / DG01), local zip/ufw, catalog probe, BLE RCSP flash |
| Advanced · GATT | Probe active services / AE00 picker |
| Advanced · Probes | Legacy `0x1A` handshake, pair, opt-in dial-info |
| Advanced · Risks | USB chipkey notes + security finding list |
| Activity | TX/RX and status log |
| Footer | Repo + protocol links, debug console, build meta |

### Device identity sources

| Field | Source |
|-------|--------|
| Name | GAP / picker |
| Model, firmware, hardware, software, manufacturer | GATT **DIS** `0x180A` (`2A24`…`2A29`) |
| Battery | GATT Battery `0x180F` / `2A19` |
| Protocol, free/capacity | Baji `DEVICE_INFO_RESPONSE` (optional — many badges omit this) |
| Push path | **Baji** file/media if device-info works; else **FitPro dial31** ([dial-upload](protocol/dial-upload.md)) |

If only a legacy `0xDC` pair ack arrives (e.g. **BJ-1**), the UI still shows DIS + battery. Image push uses FitPro dial upload; Baji media list/allocate are skipped (they disconnect these badges).

### Architecture

| Module | Role |
|--------|------|
| `js/protocol.js` | Frame codec (Baji + FitPro CD), CRC32, GATT UUIDs, `REPO_URL` |
| `js/fitpro.js` | FitPro dial31 builders + dial-info parse |
| `js/ota-catalog.js` | CDN presets, zip→ufw, tomato probe helpers |
| `js/jieli-ota.js` | JieLi RCSP OTA over `AE00`/`AE01`/`AE02` |
| `js/advanced.js` | Advanced tab bindings |
| `js/ble.js` | Web Bluetooth UART + DIS + battery (+ optional AE00) |
| `js/client.js` | `SuperBandClient` multi-session hub + per-badge `BadgeSession` |
| `js/image.js` | Cover-crop + RGB565 (FitPro) / JPEG 4:4:4 (alg 4 / Baji) |
| `js/app.js` | UI bindings |

### Multi-device notes

Web Bluetooth can keep **several GATT connections** at once. Each **Add badge** call needs a fresh user gesture (`requestDevice`). The adapter / OS may limit how many LE links stay up. Selecting a device that is already connected focuses that session instead of duplicating it.

### Image pipeline

1. User picks image  
2. Cover-crop to dial width×height (round mask default on; dims may follow dial-info)  
3. FitPro: RGB565 LE; algorithm-4 JPEG quality ~0.5 (TurboJPEG ~50)  
4. **Baji path:** optional `allocateMediaId` → file-transfer chunks (~200 B)  
5. **FitPro path (BJ-1):** dial31 start → data (seq + byte-sum) → finish; status `1000+n` / `2`  

### Advanced tab workflow (OTA)

Mirrors [`tools/send-ota.sh`](../tools/send-ota.sh):

1. Open **Advanced** → choose preset **BJ-1** or **DG01** → **Prepare preset** (or pick a local `.zip` / `.ufw`)
2. Connect the badge (Manager hero) or use **Picker → probe AE00**
3. Confirm **JieLi OTA AE00: YES** in the probe output
4. Check the brick-risk box → **Flash UFW to active** (or **Picker + flash**)
5. Prefer matching OEM cut; see [Security](protocol/security.md) and [Firmware OTA](protocol/ota-firmware.md)

Tomato **Probe catalog** may fail in the browser (no CORS); CDN presets and local files do not need the catalog.

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
