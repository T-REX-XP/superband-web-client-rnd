# Firmware OTA (JieLi)

How SuperBand checks for and applies badge firmware. Separate from the Baji media/file UART plane.

## Summary

| Item | Value |
|------|-------|
| Chip / OTA stack | JieLi (`plarmType == 7`) → `JliOTAActivity` |
| GATT OTA service | `0000AE00-0000-1000-8000-00805F9B34FB` |
| OTA chars | `AE01` write, `AE02` notify (+ CCCD) |
| Check API | `GET https://tomato.gulaike.com/api/v1/config/app` |
| Artifact format | Zip containing JieLi `app.ufw` |
| In APK | **No** badge firmware binary (only TTS/VAD assets) |

## Version inputs the app uses

From `HttpHelper.getOTAUpgradeInfo` / `OTASDKManager`:

1. **Bluetooth name** — GAP name stored after connect (`ug3.d()`), e.g. `DG01` or `*_Vn_BadgeOK`
2. **Soft version** — DIS **Firmware Revision** `0x2A26`, ASCII (`pp.e` on the characteristic value), posted as `wr2`

Request (both `plarmType` branches build the same URL):

```http
GET https://tomato.gulaike.com/api/v1/config/app?name={btName}&type=1&version={softVersion}
Authorization: Bearer 6fcb7f58475b4e5aad8f0f1cadce235e
```

Observed app headers also include `app-type`, base64 `app-name` (`com.legend.smartwatch.electronicbadge.android`), `app-version`, `country`.

Response `data` (when an upgrade exists) includes:

- `name` — catalog product code (e.g. `LJ733`)
- `version` — catalog key (must match the query `version` for a hit)
- `app_down_url` / `appDownUrl4g` — zip URL
- `force` — `1` = forced update dialog path

The app downloads the zip, unpacks files whose names contain `app`, then flashes via JieLi BLE OTA (`AE00`).

## Catalog behaviour (probed)

Lookup is effectively **exact match on the `version` query string** (catalog row’s `version` field). The `name` parameter is largely ignored: the same row is returned for `DG01`, `LJ733`, `BadgeOK`, etc., when `version` matches.

Examples that return rows for this ecosystem:

| Query `version` | Catalog `name` | Download (filename encodes target build) |
|-----------------|----------------|------------------------------------------|
| `V32294` | `LJ733` | [`…/LJ733/V32399_…_DG01_SUPERBAND.zip`](https://cdn.jusonsmart.com/0ta/LJ733/V32399_A12172156_LJ733_V1.2_YJ435_DG01_SUPERBAND.zip) (`force: 1`) |
| `V32172` | `LJ733` | [`…/LJ733/V32286_…_BJ-1_SUPERBAND.zip`](https://cdn.jusonsmart.com/0ta/LJ733/V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip) |
| `V27423` | `LJ733` | [`…/LJ733/V27550.zip`](https://res.jusonsmart.com/0ta/LJ733/V27550.zip) (`force: 1`) |
| `V34250` | `LJ733` | [`…/LJ733B/V34574_…_HYX_ZTFITPRO.zip`](https://cdn.jusonsmart.com/0ta/LJ733B/V34574_A05271020_LJ733_V1.1_HYX004_HYX_ZTFITPRO.zip) |
| `V32449` | `LJ733` | [`…/LJ733B/V34576_…_HYX_ZTFITPRO.zip`](https://cdn.jusonsmart.com/0ta/LJ733B/V34576_A05251756_LJ733_V1.1_HYX004_HYX_ZTFITPRO.zip) |

Querying **`V32399`** returns `data: null` — that string is the **target build in the zip name / UI**, not the catalog lookup key. Devices already on that revision (or reporting a different `2A26` string) will not be offered that row.

CDN roots used by responses: `https://cdn.jusonsmart.com/0ta/…`, `https://res.jusonsmart.com/0ta/…` (legacy `static.jusonsmart.com` also appears for other products).

## DG01 / SuperBand badge package

Cross-check with field notes (GAP name `DG01`, board/DIS string family `LJ733_*`, UI build `V32399`):

| Field | Value |
|-------|-------|
| URL | `https://cdn.jusonsmart.com/0ta/LJ733/V32399_A12172156_LJ733_V1.2_YJ435_DG01_SUPERBAND.zip` |
| Catalog query | `version=V32294` (any `name`; product returned as `LJ733`) |
| Zip | 3 900 911 bytes · sha256 `9fc02aec53c6faaf60b86831dce5227c675d4b9fac74e0f14933022df4bd2ec4` |
| Payload | `app.ufw` · 4 237 888 bytes · sha256 `176b43da70115a1368548fc2ebd370a60cf01aa10fb4ac27ecbecf4b9cb398e1` |
| Tags in filename | `LJ733` · `V1.2` · `YJ435` · `DG01` · `SUPERBAND` |

### BJ-1 SuperBand package

Observed GAP name **`BJ-1`** (Web Bluetooth picker). Matching CDN package:

| Field | Value |
|-------|-------|
| URL | `https://cdn.jusonsmart.com/0ta/LJ733/V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip` |
| Catalog query | `version=V32172` |
| Tags in filename | `LJ733` · `V1.2` · `ZX400` · `BJ-1` · `SUPERBAND` |

Related but **not** confirmed as the same SKU: `LJ755` / `LJ760` (BJ089 watch-class naming), `LJ733B` HYX/ZTFITPRO builds (same `LJ733` catalog name, different CDN folder / OEM tag).

## Local copies / tools

```bash
./tools/download-firmware.sh --preset dg01
./tools/download-firmware.sh --preset bj1
./tools/download-firmware.sh --version V32172 --name BJ-1
bun tools/probe-ota.mjs --name BJ-1 --version V32172

# Prepare + send OTA (BLE AE00 via openwearota; see risks)
./tools/send-ota.sh --preset bj1 --prepare
./tools/send-ota.sh --scan
./tools/send-ota.sh --preset bj1 --ble --address AA:BB:CC:DD:EE:FF
./tools/send-ota.sh --usb-hint
```

Zips unpack under `research/firmware/` (gitignored). See [tools/README.md](../../tools/README.md) and [Security research](security.md).

## How to check a live badge

1. Connect (nRF Connect, Web client, or `dg01-ble device-info`).
2. Read GAP name and DIS `0x2A26` firmware revision.
3. Call the tomato URL above with those values (or `./tools/download-firmware.sh --version … --name …`).
4. If `data.app_down_url` is set, download → unzip → `app.ufw` for JieLi OTA tooling.

Do **not** flash a zip meant for another catalog product (`LJ755`, glass, etc.) onto the wrong SKU. Prefer the filename tag that matches the GAP name (`DG01` vs `BJ-1`).

## Settings note

`mywatchc.jusonsmart.com` `app/setting/loadall` may return `"ota":"off"` and `btnames: LH728,LH726` for watch SKUs. Badge OTA still uses the tomato `config/app` path above when the app’s OTA UI runs.

## Related sources (unpacked APK)

| Topic | Path |
|-------|------|
| Check URL | `xfkj/fitpro/activity/ota/api/HttpHelper.java` |
| Download / unzip | `xfkj/fitpro/activity/ota/OTAHelper.java` |
| JieLi UI | `xfkj/fitpro/activity/ota/JliOTAActivity.java` |
| Platform routing | `xfkj/fitpro/activity/ota/OTAProxyUtils.java` (`plarmType == 7`) |
| Soft version event | DIS `2A26` → `wr2` in MyWatch BLE callback |
| AE00 discovery | `xfkj/fitpro/activity/ota/manager/OTASDKManager.java` |

## Related docs

- [Security research](security.md) — public CDN, hardcoded token, UART/USB risks
- [Firmware hardware](firmware-hw.md) — AC707N SoC, CST816D, flash map
- [GATT](gatt.md) — `AE00` / DIS UUIDs
- [RnD investigation](../rnd-investigation.md)
