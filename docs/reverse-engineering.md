# Reverse engineering notes

How the protocol docs were derived from **SuperBand 2.1.25**.

## Artifact

| Item | Value |
|------|-------|
| Bundle | `artifact/SuperBand_2.1.25_apkcube.apks` |
| Package | `com.legend.smartwatch.electronicbadge.android` |
| Version code | 103 |
| Primary APK | `base.apk` |

## Unpack

```bash
unzip artifact/SuperBand_2.1.25_apkcube.apks -d unpacked/apks
jadx -d unpacked/jadx --show-bad-code --no-res unpacked/apks/base.apk
```

`unpacked/` is gitignored (large).

## Key source locations

| Topic | Path under `unpacked/jadx/sources/` |
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
3. Decompile with jadx
4. Trace `BajiProtocolManager.sendDataToDevice` → GATT write characteristic
5. Read `ProtocolEncoder.buildPacket` / `parsePacket` for wire layout
6. Read `FileTransferService.buildFileInfoPayload` for TRANSFER_START TLV (differs from encoder’s generic `FileInfo` builder)
7. Confirm opcode numeric values (including those aliased via `AttrAndFunCode` constants)
8. Reimplement codec in `webapp/js/protocol.js` and cross-check hex against encoder math

## Gotchas

- **Two frame dialects** share `0xCD`; only Baji uses `productId == 0x25`.
- **TRANSFER_START** on the wire is the **14-byte TLV**, not `ProtocolEncoder.buildFileInfoPayload(FileInfo)`.
- **parsePacket** payload slice includes `commandId`; handlers should prefer `CommandHeader` + payload from offset 9.
- Opcode enums sometimes reference `AttrAndFunCode.SYS_INFO_ATTR_*` whose values are plain integers `11`–`18` — not JieLi RCSP semantics in this context.
- OTA stacks (JieLi `AE00`, Nordic DFU `FED*`, Telink) are separate from Baji media transfer.

## Related documentation

Start at [README](README.md) → [Protocol overview](protocol/overview.md).
