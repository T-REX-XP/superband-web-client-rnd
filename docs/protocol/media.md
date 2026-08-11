# Media management module (`0x02`)

Manages media IDs and on-device assets (list, delete, preview, background). Uploads themselves use the [file transfer](file-transfer.md) module; media management allocates IDs and queries metadata.

## Commands

| Name | ID |
|------|----|
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

## Allocate media ID

Required before upload when the app uses `mediaId == -1`.

1. App → `MEDIA_ID_REQUEST` (`0x0D`), empty payload  
2. Dev → `MEDIA_ID_RESPONSE` (`0x0E`):

```
u64 mediaId | u8 success (≠0) | message UTF-8…
```

Timeout used by the app: **30 seconds**.

## Delete

Request: `u64 mediaId`  
Response pattern (app-side): `u64 mediaId | u8 ok | message`

## Info / preview / background

| Op | Request payload | Response (typical) |
|----|-----------------|--------------------|
| INFO / PREVIEW / BACKGROUND REQUEST | `u64 mediaId` | see media info / blob |
| PREVIEW / BACKGROUND RESPONSE | — | `u64 mediaId \| u32 size \| data[size]` |

### Media info record (device → app parse path)

```
u64 mediaId
u32 nameLen | name UTF-8
u32 fileSize
u8  fileType
u32 checksum
u32 timestamp
u32 previewSize
u32 backgroundSize
u32 metaLen | metadata "k=v;k=v" UTF-8
```

`LIST_RESPONSE` repeats media-info records.

### Batch preview info response

```
u32 idCount | u64 ids…
u32 previewCount | (u64 id | u32 size | data)…
```

## Function types (used with transfers)

| Name | Value | Role |
|------|------:|------|
| `BACKGROUND` | 1 | Main badge face / background |
| `STICKER` | 2 | Overlay asset |
| `FONT` | 3 | Font resource |
| `PREVIEW` | 4 | Preview thumbnail asset |

## Web console

- **Allocate media ID** / auto-allocate before push  
- **Media list**  
- **Delete** by numeric ID  

## Related

- [File transfer](file-transfer.md)
- [Examples](examples.md)
