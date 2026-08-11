# Packet examples

All hex is space-separated, big-endian Baji unless noted.

## Legacy pair

```
cd 00 06 12 01 0a 00 01 02
```

Not Baji (`[3] = 0x12`).

## Device info request

Module `0x03`, cmd `0x00`, empty payload:

```
cd 00 06 25 01 03 00 01 00
```

| Bytes | Meaning |
|-------|---------|
| `cd` | start |
| `00 06` | dataLength = 6 |
| `25` | product |
| `01` | version |
| `03` | SYSTEM |
| `00 01` | bodyLen = 1 |
| `00` | DEVICE_INFO_REQUEST |

## Media ID request

```
cd 00 06 25 01 02 00 01 0d
```

Module `MEDIA` (`0x02`), cmd `MEDIA_ID_REQUEST` (`0x0D`).

## Transfer start (example)

Image, background, size `1000` (`0x3E8`), mediaId `42`:

```
cd 00 14 25 01 01 00 0f 00
07 00 00 03 e8
08 01
0a 01
09 00 00 00 2a
```

Breakdown of payload:

| Hex | Meaning |
|-----|---------|
| `07` | tag size |
| `00 00 03 e8` | fileSize = 1000 |
| `08` | tag type |
| `01` | IMAGE |
| `0a` | tag function |
| `01` | BACKGROUND |
| `09` | tag mediaId |
| `00 00 00 2a` | mediaId = 42 |

Full frame length = `9 + 14` = 23 bytes (`dataLength` = `0x14` = 20).

## File data chunk (structure)

Payload layout (not a full hex dump — data omitted):

```
[fileId u64][chunkIndex u32][chunkSize u32][isLast u8][data…]
```

Example header for `fileId=1`, `chunkIndex=0`, `chunkSize=200`, not last:

```
00 00 00 00 00 00 00 01
00 00 00 00
00 00 00 c8
00
<200 bytes>
```

Wrapped with Baji header: module `0x01`, cmd `0x0A`.

## Transfer complete

`fileId=1`, CRC32 `0x3610a686` (CRC of ASCII `hello` — illustrative only):

```
payload:
00 00 00 00 00 00 00 01
36 10 a6 86
```

Command `0x06`.

## Verification request

```
payload: 00 00 00 00 00 00 00 01
cmd: 0e
```

## Building frames in the console

1. Open **Raw** tab  
2. Set module / command / optional payload hex  
3. **Build & send Baji packet**  

Or paste a full frame into **Raw hex write**.

Codec unit check (Node):

```bash
cd /opt/superband
node --input-type=module -e "
import { buildPacket, toHex } from './web/js/protocol.js';
console.log(toHex(buildPacket(3, 0)));
"
```
