# System info module (`0x03`)

Queries device identity and storage capabilities.

## Commands

| Name | ID | Direction | Payload |
|------|----|-----------|---------|
| `DEVICE_INFO_REQUEST` | `0x00` | App → Dev | empty |
| `DEVICE_INFO_RESPONSE` | `0x01` | Dev → App | see below |

Stubs exist in the Android SDK for capability / storage status requests but **no opcodes** are wired.

## Request

```
buildPacket(module=0x03, cmd=0x00, payload=[])
→ CD 00 06 25 01 03 00 01 00
```

## Response payload layout

As built by `ProtocolEncoder.buildDeviceInfoPayload` (treat this as the encoder’s canonical layout; parsers in the app are slightly inconsistent on the features field):

```
u32 nameLen          | name UTF-8
u32 verLen           | deviceVersion UTF-8
u32 protoLen         | protocolVersion UTF-8
u64 storageCapacity
u64 freeStorage
u32 fileTypeCount    | fileType bytes[count]
u64 maxFileSize
u32 featuresLen      | features UTF-8
```

`features` is typically a comma-joined string when encoded by the app’s own builder.

## Web console

The manager auto-requests device info after connect. Some badges (e.g. GAP name **`BJ-1`**) only return a legacy `0xDC` ack to the pair frame and never emit `DEVICE_INFO_RESPONSE`; the client logs a timeout and stays usable for media/file commands. Read firmware revision from DIS `0x2A26` when Baji info is missing.

## Related

- [Framing](framing.md)
- [Commands](commands.md)
