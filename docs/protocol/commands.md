# Command reference

Quick lookup for Baji modules, opcodes, types, and errors. Framing details: [framing.md](framing.md).

## Modules

| Name | ID |
|------|----|
| `FILE_TRANSFER` | `0x01` |
| `MEDIA_MANAGEMENT` | `0x02` |
| `SYSTEM_INFO` | `0x03` |

---

## System info (`0x03`)

| Command | ID | Dir |
|---------|----|-----|
| `DEVICE_INFO_REQUEST` | `0x00` | → |
| `DEVICE_INFO_RESPONSE` | `0x01` | ← |

Details: [system-info.md](system-info.md)

---

## File transfer (`0x01`)

| Command | ID |
|---------|----|
| `TRANSFER_START` | `0x00` |
| `TRANSFER_STOP` | `0x01` |
| `TRANSFER_ACK` | `0x02` |
| `TRANSFER_NACK` | `0x03` |
| `NEXT_CHUNK_REQUEST` | `0x04` |
| `RETRY_REQUEST` | `0x05` |
| `TRANSFER_COMPLETE` | `0x06` |
| `FILE_DATA` | `0x0A` |
| `STATUS` | `0x0B` |
| `RECEIVED_CHECKSUM` | `0x0C` |
| `TOTAL_TRANSFERRED` | `0x0D` |
| `VERIFICATION_RESULT` | `0x0E` |

Details: [file-transfer.md](file-transfer.md)

---

## Media management (`0x02`)

| Command | ID |
|---------|----|
| `MEDIA_LIST_REQUEST` | `0x00` |
| `MEDIA_LIST_RESPONSE` | `0x01` |
| `MEDIA_DELETE` | `0x02` |
| `MEDIA_INFO_REQUEST` | `0x03` |
| `MEDIA_INFO_RESPONSE` | `0x04` |
| `MEDIA_PREVIEW_REQUEST` | `0x05` |
| `MEDIA_PREVIEW_RESPONSE` | `0x06` |
| `MEDIA_PREVIEW_PUSH_REQUEST` | `0x07` |
| `MEDIA_PREVIEW_PUSH_RESPONSE` | `0x08` |
| `MEDIA_BACKGROUND_REQUEST` | `0x09` |
| `MEDIA_BACKGROUND_RESPONSE` | `0x0A` |
| `MEDIA_BACKGROUND_PUSH_REQUEST` | `0x0B` |
| `MEDIA_BACKGROUND_PUSH_RESPONSE` | `0x0C` |
| `MEDIA_ID_REQUEST` | `0x0D` |
| `MEDIA_ID_RESPONSE` | `0x0E` |
| `MEDIA_BATCH_PREVIEW_INFO_REQUEST` | `0x0F` |
| `MEDIA_BATCH_PREVIEW_INFO_RESPONSE` | `0x10` |
| `MEDIA_BATCH_PREVIEW_DATA_REQUEST` | `0x11` |
| `MEDIA_BATCH_PREVIEW_DATA_RESPONSE` | `0x12` |

Details: [media.md](media.md)

---

## FileType

| Name | Value |
|------|------:|
| `IMAGE` | 1 |
| `VIDEO` | 2 |
| `ANIMATION` | 3 |
| `MULTI_FILE` | 255 / −1 |

## FunctionType

| Name | Value |
|------|------:|
| `BACKGROUND` | 1 |
| `STICKER` | 2 |
| `FONT` | 3 |
| `PREVIEW` | 4 |

## TransferStatus

| Name | Value |
|------|------:|
| `IDLE` | 0 |
| `PREPARING` | 1 |
| `TRANSFERRING` | 2 |
| `PAUSED` | 3 |
| `COMPLETED` | 4 |
| `FAILED` | 5 |
| `CANCELLED` | 6 |

## Error codes

| Code | Name |
|-----:|------|
| 0 | `SUCCESS` |
| 1 | `INVALID_PACKET` |
| 2 | `UNSUPPORTED_COMMAND` |
| 3 | `INVALID_PARAMETER` |
| 4 | `FILE_NOT_FOUND` |
| 5 | `FILE_TOO_LARGE` |
| 6 | `INSUFFICIENT_STORAGE` |
| 7 | `TRANSFER_TIMEOUT` |
| 8 | `CHECKSUM_MISMATCH` |
| 9 | `DEVICE_BUSY` |
| 10 | `FILE_SIZE_MISMATCH` |
| 11 | `VERIFICATION_FAILED` |
| 12 | `INVALID_PAYLOAD` |
| 255 | `UNKNOWN_ERROR` |

Generic error payload shape: `u8 errorCode | message UTF-8…`  
NACK payload: `u64 fileId | u32 errorCode | message UTF-8`

## Legacy (non-Baji)

| Frame | Hex | Purpose |
|-------|-----|---------|
| Pair | `CD 00 06 12 01 0A 00 01 02` | Sent after notify enable |

## Protocol constants cheat sheet

| Constant | Value |
|----------|-------|
| Start | `0xCD` |
| Product | `0x25` |
| Version | `0x01` |
| Chunk | 200 bytes |
| Max file | 10 MiB |
| Company ID (adv) | `0xAA01` |
| Device type badge | `3` |
