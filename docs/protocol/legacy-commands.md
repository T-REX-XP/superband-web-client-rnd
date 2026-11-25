# Legacy MyWatch commands (FitPro modules `0x12` / `0x15` / `0x1C` / `0x1D`)

Besides the Baji (`0x25`) packets and the FitPro dial push (`0x1F`/`0x20`),
the badge speaks plain `0xCD` **legacy MyWatch** frames for settings, device
control and sport toggles. These were reconstructed from **SuperBand 1.10.04**
(`com.legend.mywatch` SDK: `bluetooth/SendData`, `bluetooth/Profile.PBSmartBandCommandId*`).

Implemented in the manager in [`src/js/commands.js`](../../src/js/commands.js)
(Quick actions panel) and in the debug console (`debug-console/js/protocol.js`).

## Frame layout

`buildFitProFrame(module, key, payload)`:

```
CD | u16BE(len-3) | module | 01 | key | u16BE(payloadLen) | payload
```

Three shapes follow from it:

| Shape | Bytes | Example |
|---|---|---|
| value | `CD 00 (5+n) mod 01 key 00 n …` | sync time `CD 00 09 12 01 01 00 04 <u32>` |
| no-value | `CD 00 05 mod 01 key 00 00` | enter OTA `CD 00 05 12 01 19 00 00` |
| switch | `CD 00 06 mod 01 key 00 01 <v>` | find ON `CD 00 06 12 01 0B 00 01 01` |
| short | `CD 00 02 mod 01` | reset `CD 00 02 1D 01` |

`SwitchProtocol(cmd, key, value)` in the APK is the "switch" shape above.

## Modules

| ID | Name | Notes |
|---:|---|---|
| `0x11` | Firmware upgrade | |
| `0x12` | **Setting** | sub-keys below |
| `0x13` | Binding | short frame |
| `0x14` | Strapped / worn | |
| `0x15` | **Sport** | realtime step, history |
| `0x16` | Reset (v1) | |
| `0x17` | Message-push switch | |
| `0x18` | Alarm list | |
| `0x19` | Other set-info | |
| `0x1A` | Set-info-by-key | MAC, capability |
| `0x1B` | Test mode | |
| `0x1C` | **Device control** | `0x1C sub` keys |
| `0x1D` | Device reset | short frame |
| `0x1E` | Factory mode | |
| `0x1F` | Dial update | see [dial-upload](dial-upload.md) |
| `0x20` | Dial read | see [dial-upload](dial-upload.md) |
| `0x21` | Game | |
| `0x22` | Private (temperature) | |
| `0x26` | AI-gadgets product | AI glasses |
| `0x27` | **Realtime preview** | see [live-preview](live-preview.md) |

## Setting sub-keys (module `0x12`)

| Key | Meaning | Key | Meaning |
|---:|---|---:|---|
| `0xFD` | Shutdown | 23 | Delete contact |
| `0xFE` | Heart-rate setting | 24 | Measure (HR/BP/SpO₂) |
| `0xFF` | Phone type | 25 | Enter OTA mode |
| 1 | Sync time | 26 | ECG measure |
| 2 | Alarm clock | 27 | SpO₂ switch |
| 3 | Step target | 32 | Weather |
| 4 | User info | 33 | Temperature unit |
| 5 | Long-sit reminder | 34 | Target sport time |
| 6 | Hand side | 35 | Target stand time |
| 7 | Call/message remind | 36 | Get history calories |
| 8 | Raise-to-wake | 37 | Timer heart rate |
| 9 | Bright screen | 38 | Sleep reminder |
| 10 | Is-paired / bind | 39 | Target kcal |
| 11 | **Find me** | 40 | Drink reminder |
| 12 | Take photo | 41 | SOS contact |
| 13 | Heart-rate switch | 42 | Gesture control |
| 14 | Blood-pressure switch | 43 | Phone IMEI |
| 15 | Sleep switch | 44 | OTA count |
| 16 | Test-data switch | 45 | Pay (QR) |
| 17 | Phone-call push | 46 | AI (glasses) settings |
| 18 | Notification push | | |
| 19 | Sync contacts | | |
| 20 | Do-not-disturb | | |
| 21 | Language | | |
| 22 | Auto heart rate | | |

## Device control sub-keys (module `0x1C`, no-value frames)

| Key | Action | Key | Action |
|---:|---|---:|---|
| 1 | Find phone | 9 | Answer call |
| 2 | Take photo | 10 | Switch up |
| 3 | Open camera | 11 | Switch pause |
| 4 | Exit camera | 12 | Switch down |
| 5 | Exit heart | 13 | Exit SpO₂ |
| 6 | Exit blood | 14 | Stop find phone |
| 7 | Hang up | 15 | Sync time |
| 8 | Exit measure | 16 | Get IMEI |

## Payload encodings

**Sync time** (module `0x12` key 1, 4 bytes BE):

```
v = second | (year-2000)<<26 | month<<22 | day<<17 | hour<<12 | minute<<6
```

**User info** (module `0x12` key 4, 4 bytes BE):

```
v = sex<<31 | age<<24 | height(cm)<<15 | weight(kg)<<5
```

**Step target** (module `0x12` key 3): `u32BE(steps)`.

**Device MAC** (module `0x1A` key 10, response, 6 bytes): the badge's own
**BD_ADDR**, e.g. `AA BB CC DD EE FF` → `AA:BB:CC:DD:EE:FF`. This is the
*identity* address — the same one the badge shows on its screen (and its QR
code). The host OS / Web Bluetooth may expose a **different** random
(resolvable private) address for the same device, so treat the MAC from this
response as authoritative. The manager stores it as `deviceMac` and shows it as
**BLE MAC** in the identity grid.

**Device name** (module `0x1A` key 12, response): `u8 len ‖ ASCII`, e.g.
`04 42 47 30 32` → `"BG02"`.

**Capability** (module `0x1A` key 28, response): 6 bytes, e.g. `01 20 00 00 00 01`.

## Worked frames

| Action | Bytes |
|---|---|
| Sync time | `CD 00 09 12 01 01 00 04 <u32>` |
| Find ON | `CD 00 06 12 01 0B 00 01 01` |
| Find OFF | `CD 00 06 12 01 0B 00 01 00` |
| Set step goal 10000 | `CD 00 09 12 01 03 00 04 00 00 27 10` |
| Remote photo page ON | `CD 00 06 12 01 0C 00 01 01` |
| Enter OTA mode | `CD 00 05 12 01 19 00 00` |
| Shutdown | `CD 00 05 12 01 FD 00 00` |
| Realtime step ON | `CD 00 06 15 01 06 00 01 01` |
| Device reset | `CD 00 02 1D 01` |
| Legacy MAC request | `CD 00 05 1A 01 0A 00 00` |
| Legacy MAC response | `CD 00 0B 1A 01 0A 00 06 AA BB CC DD EE FF` |
| Find phone (device control) | `CD 00 05 1C 01 01 00 00` |
| Remote shutter (device control) | `CD 00 05 1C 01 02 00 00` |

## References

- [Framing](framing.md) · [Dial upload](dial-upload.md) · [Live preview](live-preview.md)
- Gadgetbridge `FitProConstants.java` independently lists the same `0xCD`
  settings/device-control frames (`find band`, `find phone`, camera, …).
