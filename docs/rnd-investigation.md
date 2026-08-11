# RnD investigation notes

How the protocol docs were derived during RnD investigation of **SuperBand 2.1.25**.

## Artifact

| Item | Value |
|------|-------|
| Bundle | `artifacts/SuperBand_2.1.25_apkcube.apks` |
| Package | `com.legend.smartwatch.electronicbadge.android` |
| Version code | 103 |
| Primary APK | `base.apk` |

## Unpack

```bash
./tools/unpack-apk.sh
# equivalent:
# unzip artifacts/SuperBand_2.1.25_apkcube.apks -d research/unpacked/apks
# jadx -d research/unpacked/jadx --show-bad-code --no-res research/unpacked/apks/base.apk
```

`research/unpacked/` is gitignored (large). Scripts: [tools/README.md](../tools/README.md).

## Key source locations

| Topic | Path under `research/unpacked/jadx/sources/` |
|-------|-------------------------------------|
| Frame codec | `com/baji/protocol/utils/ProtocolEncoder.java` |
| Constants | `com/baji/protocol/model/ProtocolConstants.java` |
| Modules / cmds | `com/baji/protocol/model/{ModuleId,FileTransferCommand,MediaManagementCommand,SystemInfoCommand,FileType,FunctionType,ErrorCode}.java` |
| Manager | `com/baji/protocol/BajiProtocolManager.java` |
| Transfer | `com/baji/protocol/service/FileTransferService.java` |
| CRC | `com/baji/protocol/utils/Crc32Utils.java` |
| GATT UUIDs | `defpackage/o72.java`, `defpackage/i10.java` |
| Legacy cmds | `defpackage/qm2.java` |
| Scan filter | `xfkj/fitpro/ui/viewmodels/bluetooth/BluetoothScanViewModel.java` |
| Name regex | `defpackage/v90.java` |
| Mfg parse | `defpackage/kl.java` |
| BLE write path | `com/legend/mywatch/sdk/mywatchsdklib/android/bluetooth/` |

## Method

1. Extract `.apks` → `base.apk`
2. String-scan DEX for UUIDs (`ae00`, `7E40…`, `Baji`, `BadgeOK`)
3. Inspect sources with jadx
4. Trace `BajiProtocolManager.sendDataToDevice` → GATT write characteristic
5. Read `ProtocolEncoder.buildPacket` / `parsePacket` for wire layout
6. Read `FileTransferService.buildFileInfoPayload` for TRANSFER_START TLV (differs from encoder’s generic `FileInfo` builder)
7. Confirm opcode numeric values (including those aliased via `AttrAndFunCode` constants)
8. Implement codec in `src/js/protocol.js` (and the debug console copy) and cross-check hex against encoder math

## Gotchas

- **Two frame dialects** share `0xCD`; only Baji uses `productId == 0x25`.
- **TRANSFER_START** on the wire is the **14-byte TLV**, not `ProtocolEncoder.buildFileInfoPayload(FileInfo)`.
- **parsePacket** payload slice includes `commandId`; handlers should prefer `CommandHeader` + payload from offset 9.
- Opcode enums sometimes reference `AttrAndFunCode.SYS_INFO_ATTR_*` whose values are plain integers `11`–`18` — not JieLi RCSP semantics in this context.
- OTA stacks (JieLi `AE00`, Nordic DFU `FED*`, Telink) are separate from Baji media transfer.

## Firmware OTA investigation

No badge firmware is bundled in the APK. The app queries:

`GET https://tomato.gulaike.com/api/v1/config/app?name={btName}&type=1&version={DIS 2A26}`

with a fixed Bearer token from `HttpHelper`. Catalog hits are keyed by the **exact** `version` string (bluetooth `name` is weak/ignored in probes).

**DG01 SuperBand package** (filename match):

`https://cdn.jusonsmart.com/0ta/LJ733/V32399_A12172156_LJ733_V1.2_YJ435_DG01_SUPERBAND.zip`

offered when soft version is **`V32294`** (not `V32399` — that is the target build / UI string). Zip → `app.ufw` → JieLi `AE00` flash (`plarmType == 7`).

**BJ-1 SuperBand package** (GAP name `BJ-1`):

`https://cdn.jusonsmart.com/0ta/LJ733/V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip`

(catalog key **`V32172`**).

```bash
./tools/download-firmware.sh --preset bj1
./tools/download-firmware.sh --preset dg01
```

Details: [Firmware OTA](protocol/ota-firmware.md) · [tools/README.md](../tools/README.md).

## Related documentation

Start at [README](README.md) → [Protocol overview](protocol/overview.md).
