# FitPro dispatch map (`app.bin` static RE)

Source: `research/firmware/analysis/bj1_unpack/files/app.bin` (979721 bytes)
Compared DG01: {"same_size": false, "len_a": 979721, "len_b": 979778}

## Verdict

Stock `app.bin` is a stripped AC707N image. This pass does **not** recover C source;
it locates FitPro module/command immediates, status constant `1000`, dial id `5538`,
and UI/decode strings that anchor a Ghidra project.

## Embedded / triplet hits

### Module·cmd triplets (`module | 0x01 | cmd`)

| Pattern | Count | Sample offsets |
|---------|------:|----------------|
| `mod1f_cmd_data` | 1 | 0x8d03e |
| `mod1f_cmd_start` | 1 | 0x11f8e |
| `mod1f_cmd_finish` | 0 | — |
| `mod20_cmd_status` | 2 | 0xadd5c, 0xade3a |
| `mod20_cmd_info` | 0 | — |
| `mod1a_legacy` | 42 | 0x96d5, 0xa8a0, 0xb9f9, 0xbdc8, 0x13d19, 0x1cbe1, 0x1f497, 0x280fa |

### Status constant 1000 (`0x03E8`)

- LE dword count: **2**
- BE dword count: **1**

Chunk ACK band in the host protocol is `1000 + seq` (see `docs/protocol/dial-upload.md`).
LE hits are the primary Ghidra seeds for the upgrade-status emitter.

### Picture dial id 5538

```json
{
  "5538_u32be": [],
  "5538_u32le": [
    924228
  ],
  "5538_u16be": [
    97635,
    197265,
    275787,
    275839,
    275851,
    275875,
    365390,
    394994,
    408917,
    409073,
    571709,
    726757,
    729743,
    729813,
    729981,
    730085
  ],
  "5538_u16le": [
    160148,
    196182,
    197022,
    197266,
    208886,
    275788,
    275840,
    275852,
    275876,
    521054,
    557376,
    636284,
    648871,
    726758,
    726808,
    729600
  ]
}
```

## Interesting strings (xref seeds)

| Offset | Needle | String |
|-------:|--------|--------|
| `0xdb5a6` | `watch.sty` | `storage/res_fs_dev/C/watch.sty` |
| `0xe00b4` | `res_nor_dial` | `res_nor_dial` |
| `0xdfe10` | `JLHWJPEG` | `JLHWJPEG` |
| `0xdb88f` | `jpeg_decode` | `jpeg_decode` |
| `0xdafa8` | `tp_cst816d` | `tp_cst816d` |
| `0xdb17a` | `lcd_init` | `lcd_init` |
| `0xdb06f` | `lcd_backlight` | `lcd_backlight` |
| `0xdaf50` | `storage/nor_ui` | `storage/nor_ui` |
| `0xdaf5f` | `storage/nor_ui` | `storage/nor_ui/C/` |
| `0xdfe2d` | `bgp_wa` | `/bgp_wa%d` |
| `0xe011f` | `bgp_wa` | `/bgp_wa%d.avi` |
| `0xe09c1` | `bgp_wa` | `storage/res_fs_dev/C/bgp_wa%d` |
| `0xe0b61` | `bgp_wa` | `storage/res_fs_dev/C/bgp_wa%d.avi` |
| `0xb58c8` | `AC707N` | `AC707N_V1.0.0-@20250403-$14f6057c` |
| `0xdafc7` | `JLOTA` | `JLOTA` |
| `0xb79fc` | `ble_ota` | `Zble_ota.bin` |
| `0xe00bc` | `dial` | `res_nor_dial` |
| `0xe33ac` | `dial` | `dial` |

## Suggested Ghidra workflow

1. Load `app.bin` as raw ARM (entry hint `0x0C000100` from UFW / `isd_config`).
2. Navigate to LE `1000` hits and `1f 01 02` / `20 01 01` triplets; define functions upward.
3. Cross-ref `JLHWJPEG` / `jpeg_decode` / `lcd_*` / `res_nor_dial` strings for the image path.
4. Mark dispatch: UART RX → parse `CD` frame → switch(module) → `0x1F`/`0x20` handlers.
5. Confirm status codes `1..9` and `1000+n` writers feed notify characteristic `7E400003`.

## Clean-room implication

Open firmware should **reimplement** the host-visible contract in
`docs/protocol/firmware-contract.md` rather than transplanting these offsets.
