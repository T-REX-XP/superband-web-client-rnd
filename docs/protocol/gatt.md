# GATT services & characteristics

## Primary UART (Baji data plane)

Configured in reference client helpers `defpackage.o72` / `defpackage.i10`, used by the MyWatch SDK bluetooth layer.

| Role | UUID | Properties (typical) |
|------|------|----------------------|
| **Service** | `7E400001-B5A3-F393-E0A9-E50E24DCCA9D` | Primary |
| **Write (phone → device)** | `7E400002-B5A3-F393-E0A9-E50E24DCCA9D` | Write / write without response |
| **Notify (device → phone)** | `7E400003-B5A3-F393-E0A9-E50E24DCCA9D` | Notify |
| **Log notify (optional)** | `7E400004-B5A3-F393-E0A9-E50E24DCCA9D` | Notify |
| CCCD | `00002902-0000-1000-8000-00805F9B34FB` | Client config |

Notes:

- Service discovery also accepts other UUIDs matching `7E4*…F393-E0A9-E50E24DCCA9D`.
- Enable notifications with CCCD value `0x0001` (Web Bluetooth `startNotifications()` does this).
- App requests **MTU 512**. Web Bluetooth does not expose `requestMtu`; Chrome negotiates automatically.
- Application chunk size remains **200** bytes regardless of MTU (see [File transfer](file-transfer.md)).

## Standard / secondary services

| Service / characteristic | UUID | Use |
|--------------------------|------|-----|
| Battery service | `0000180F-…` | Battery |
| Battery level | `00002A19-…` | Read % |
| Device information | `0000180A-…` | DIS |
| Firmware revision | `00002A26-…` | Read |
| Software revision | `00002A28-…` | Read |
| JieLi OTA service | `0000AE00-…` | OTA path |
| JieLi chars | `AE01`, `AE02` | OTA write/notify |
| Alternate UART | `0000FFFF` + `FF11` / `FF22` | Platform type alternate |
| Telink-style | `00010203-0405-0607-0809-0a0b0c0d1912` | OTA-related |

These are **not** used for Baji media/file commands.

## Web console mapping

`web/js/ble.js` connects to the UART service, enables notify on `…003`, writes to `…002`, and optionally reads battery.

## Related

- [Framing](framing.md)
- [Discovery](discovery.md)
