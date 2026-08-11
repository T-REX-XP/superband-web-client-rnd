# SuperBand documentation

Documentation for the SuperBand electronic badge BLE stack from RnD investigation of **SuperBand 2.1.25** (`com.legend.smartwatch.electronicbadge.android`), and for the Web Bluetooth clients in [`../src/`](../src/) (manager) and [`../src/debug-console/`](../src/debug-console/) (debug console).

## Contents

| Doc | Description |
|-----|-------------|
| [Getting started](getting-started.md) | Unpack layout, run the manager, connect a badge |
| [Protocol overview](protocol/overview.md) | Architecture of the Baji / UART data plane |
| [Discovery & advertising](protocol/discovery.md) | Scan filters, manufacturer data, device names |
| [GATT services](protocol/gatt.md) | UUIDs, TX/RX roles, MTU, related services |
| [Frame format](protocol/framing.md) | Packet layout, endianness, legacy frames |
| [System info](protocol/system-info.md) | Module `0x03` — device info request/response |
| [Media management](protocol/media.md) | Module `0x02` — IDs, list, delete, preview |
| [File transfer](protocol/file-transfer.md) | Module `0x01` — chunked upload, CRC32, verify |
| [Command reference](protocol/commands.md) | All modules, opcodes, types, error codes |
| [Packet examples](protocol/examples.md) | Hex dumps of real frames |
| [Firmware OTA](protocol/ota-firmware.md) | JieLi OTA check API, DG01 / BJ-1 / LJ733 zip URLs |
| [Tools](../tools/README.md) | `download-firmware.sh`, `unpack-apk.sh`, `probe-ota.mjs` |
| [Web client](web-console.md) | UI guide for `src/` manager and `src/debug-console/` console |
| [RnD investigation](rnd-investigation.md) | Reference client sources map and investigation notes |

## Device

[AliExpress listing (electronic badge)](https://es.aliexpress.com/item/1005010799519769.html?aem_p4p_detail=2026081110174310473788308808310000293153&pdp_ext_f=%7B%22order%22%3A%22340%22%2C%22eval%22%3A%221%22%2C%22fromPage%22%3A%22search%22%7D&search_p4p_id=2026081110174310473788308808310000293153_3)

## Quick facts

- **Product:** electronic badge (电子吧唧), device type `3`
- **Data plane:** Baji protocol, product ID `0x25`, start marker `0xCD`
- **Transport:** GATT UART `7E400001` / write `…002` / notify `…003`
- **Chunk size:** 200 bytes · **MTU target:** 512
- **Manager UI:** `cd src && bun install && bun run dev` → http://localhost:8787
- **GitHub Pages:** push `src/` to `main`/`master` (see `.github/workflows/pages.yml`)
