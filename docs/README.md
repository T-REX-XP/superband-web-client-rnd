# SuperBand documentation

Documentation for the SuperBand electronic badge BLE stack, reverse-engineered from **SuperBand 2.1.25** (`com.legend.smartwatch.electronicbadge.android`), and for the Web Bluetooth clients in [`../src/`](../src/) (manager) and [`../webapp/`](../webapp/) (debug console).

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
| [Web client](web-console.md) | UI guide for `src/` manager and `webapp/` console |
| [Reverse engineering](reverse-engineering.md) | APK sources map and how findings were derived |

## Quick facts

- **Product:** electronic badge (电子吧唧), device type `3`
- **Data plane:** Baji protocol, product ID `0x25`, start marker `0xCD`
- **Transport:** GATT UART `7E400001` / write `…002` / notify `…003`
- **Chunk size:** 200 bytes · **MTU target:** 512
- **Manager UI:** `cd src && bun install && bun run dev` → http://localhost:8787
