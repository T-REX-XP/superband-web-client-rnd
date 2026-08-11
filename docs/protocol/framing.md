# Frame format

All UART payloads of interest start with **`0xCD`**. Baji frames are identified by **product ID `0x25`** at offset 3.

## Constants

| Name | Value |
|------|-------|
| `PACKET_START_MARKER` | `0xCD` (−51 signed) |
| `PRODUCT_ID` | `0x25` (37) |
| `PROTOCOL_VERSION` | `0x01` (string `v1.0`) |
| `PACKET_HEADER_SIZE` | 3 |
| `MAX_PACKET_SIZE` | 512 |
| `MAX_PAYLOAD_SIZE` | 509 (constants) / 505 (encoder guard) |
| `MAX_CHUNK_SIZE` | **200** |
| `MAX_FILE_SIZE` | 10 485 760 (10 MiB) |
| `DEFAULT_TIMEOUT_MS` | 5000 |
| `CONNECTION_TIMEOUT_MS` | 10000 |
| `TRANSFER_TIMEOUT_MS` | 30000 |
| `MAX_RETRY_COUNT` | 3 |

Endianness: **big-endian**. Strings: **UTF-8**.  
There is **no CRC on the frame**; CRC32 applies to file bodies only.

## Baji wire layout

Built by `ProtocolEncoder.buildPacket(moduleId, commandId, payload)`:

```
Offset  Size  Field
------  ----  ---------------------------------
0       1     startMarker     = 0xCD
1       2     dataLength      = payloadLen + 6   (BE uint16)
3       1     productId       = 0x25
4       1     protocolVersion = 0x01
5       1     moduleId
6       2     bodyLen         = payloadLen + 1   (BE uint16)
8       1     commandId
9       N     payload
```

**Total size** = `3 + dataLength` = `9 + payloadLen`.

### Length fields

| Field | Formula | Covers |
|-------|---------|--------|
| `dataLength` | `payloadLen + 6` | productId … end of payload |
| `bodyLen` | `payloadLen + 1` | commandId + payload |

### Empty-payload example

`DEVICE_INFO_REQUEST` (module `0x03`, cmd `0x00`):

```
CD 00 06 25 01 03 00 01 00
```

## Parsing notes

Reference client `parsePacket` returns a slice that **includes** `commandId` at the start of the “payload” buffer, while also putting `commandId` in `CommandHeader`. Reimplementations should treat:

- `commandId = byte[8]`
- `payload = bytes[9 .. 9+payloadLen)`

Notify callbacks may fragment frames across MTU boundaries. Reassemble by reading `dataLength` after seeing `0xCD`, then waiting for `3 + dataLength` bytes (`PacketAssembler` in `web/js/protocol.js`).

## Legacy MyWatch frames

Same start marker, different layout. Offset 3 is a **module key**, not product `0x25`.

Typical short command builder (`qm2`):

```
CD | lenBE | moduleKey | 0x01 | cmd | payloadLenBE | payload
```

### Pairing frame (sent after notify enable)

`qm2.r()` → `a(0x12, 0x0A, 0x02)`:

```
CD 00 06 12 01 0A 00 01 02
```

Post-connect the app also sends legacy module `0x1A` probes (`D(10)`, `D(12)`). The web console sends the pair frame; Baji commands work without the full legacy handshake on many devices.

## Related

- [Commands](commands.md)
- [Examples](examples.md)
- [Overview](overview.md)
