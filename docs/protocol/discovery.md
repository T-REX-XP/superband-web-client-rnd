# Discovery & advertising

How the official app finds electronic badges during a BLE scan.

## Filters used by the app

All of the following are applied in practice:

1. **Manufacturer-specific data** with company ID **`0xAA01`** (decimal `43521`)
2. Parsed payload **device type == `3`** (electronic badge)
3. Non-empty device name (placeholder names like “未知设备” are dropped)
4. Newer firmware names matching **`_V\d+_BadgeOK$`**  
   Example: `Something_V12_BadgeOK`

Source: `xfkj.fitpro.ui.viewmodels.bluetooth.BluetoothScanViewModel`, helpers `kl`, `v90`.

## Manufacturer payload layout

When the manufacturer data length is **≥ 12** bytes:

| Offset | Field |
|--------|-------|
| `[6..10)` | Little-endian `uint32` bitfield |
| `[10]` | Device type (when `[11] == 0xDD`) |
| `[11]` | Marker `0xDD` enables type byte |

Bitfield (LE `uint32`):

| Bits | Field |
|------|-------|
| 0–16 | Version (`& 0x1FFFF`) |
| 17–23 | Battery percent (`& 0x7F`) |
| 24+ | Flags |

If length is exactly **10**, the same bitfield is taken from `[6..10)` and device type is treated as `0` (filtered out for badges).

## Web Bluetooth picker options

The console offers two modes:

| Mode | Behavior |
|------|----------|
| **Connect badge** | Filters: UART service UUID, name prefix `_V`, manufacturer `0xAA01` |
| **Connect any device** | `acceptAllDevices` + optional UART / battery / device-info services |

Browser support for `manufacturerData` filters varies; if the filtered picker is empty, use **Connect any device**.

## Related

- [GATT services](gatt.md)
- [Getting started](../getting-started.md)
