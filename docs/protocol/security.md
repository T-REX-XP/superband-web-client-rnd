# Security research (LJ733 / SuperBand)

Static analysis of DG01 / BJ-1 OTA packages (**AC707N-WATCH-SDK** `V1.0.0-@20250403-$14f6057c`) and SuperBand Android **2.1.25**, plus live HTTP probes of the OTA catalog/CDN. This is **not** a live BLE fuzz campaign.

## Verdict

| Question | Answer |
|----------|--------|
| Does the badge support OTA? | **Yes** — JieLi BLE `AE00`, cloud catalog + public CDN, USB/UART forced-update paths in uboot |
| Secret remote “vendor backdoor”? | **No evidence** of a hidden C2 or reverse shell |
| Main risk theme | Weak OEM defaults: public firmware, hardcoded API token, unauthenticated UART plane |

## OTA support map

| Path | Status | Auth model | Notes |
|------|--------|------------|-------|
| BLE JieLi `AE00` / `AE01` / `AE02` | Supported (app primary) | RCSP device auth enabled in `JliOTAActivity` (`setUseAuthDevice(true)`) | `plarmType == 7` |
| Cloud catalog + CDN | Supported | Static bearer for catalog; **CDN anonymous** | `tomato.gulaike.com` → `cdn.jusonsmart.com` zip → `app.ufw` |
| USB HID / UART update | Present in FW/uboot | Chipkey / JieLi downloader | `UARTUPDATE`, `Zusb_hid_ota.bin`, … |
| SPP / EDR / multi-media OTA stubs | Names in `app.bin` | Unknown / unused on badge? | `Zspp_app_ota`, `Zedr_ota2`, `Znand` / `Znor` / `Zlcflash` |

Tools: [`tools/download-firmware.sh`](../../tools/download-firmware.sh), [`tools/send-ota.sh`](../../tools/send-ota.sh). Protocol detail: [Firmware OTA](ota-firmware.md).

## Findings

### F1 — Critical: Hardcoded cloud OTA catalog bearer token

| | |
|--|--|
| **Surface** | Android APK → `tomato.gulaike.com` |
| **Evidence** | `HttpHelper.TOKEN = Bearer 6fcb7f58475b4e5aad8f0f1cadce235e`; wrong/missing token → `token错误`; valid token + `country` header returns FW URLs |
| **Impact** | Anyone can enumerate catalog versions and obtain official upgrade zip URLs without a user login |

### F2 — Critical: Firmware zip CDN is public (no auth)

| | |
|--|--|
| **Surface** | `cdn.jusonsmart.com/0ta/LJ733/*` |
| **Evidence** | `HEAD`/`GET` → `200`, `Access-Control-Allow-Origin: *`, BJ-1 / DG01 zips openly downloadable |
| **Impact** | Full UFW images (chipkey, `app.bin`, uboot) available for offline analysis and reflash tooling |

### F3 — High: UART command plane has no cryptographic auth

| | |
|--|--|
| **Surface** | GATT `7E40…` FitPro / Baji frames |
| **Evidence** | Connect + fixed legacy pair `CD 00 06 12 01 0A 00 01 02` → `0xDC` ack; dial31 / media cmds follow with no challenge |
| **Impact** | BLE proximity attacker can push images / issue watch-theme commands once connected (Just Works–class exposure) |

### F4 — High: Physical / forced update paths retained in bootloader

| | |
|--|--|
| **Surface** | uboot + `isd_config` |
| **Evidence** | `UARTUPDATE` / `UART_UPDATE_CUSTOM`; FW names `Zuart_update.bin`, `Zusb_hid_ota.bin`, `Zusb_update2.bin`; chipkey **`$B165`** in UFW |
| **Impact** | Classic JieLi USB/UART download mode can rewrite flash and bypass app-level BLE RCSP auth |

### F5 — Medium: Cross-SKU OTA catalog collision

| | |
|--|--|
| **Surface** | tomato `config/app` |
| **Evidence** | Lookup keyed mainly by `version` string; `name` largely ignored; `LJ733` returns DG01, BJ-1, HYX/ZTFITPRO, older `V27550` rows |
| **Impact** | Wrong image offered or flashed if DIS / GAP string mismatches OEM cut — brick / feature-wipe risk |

### F6 — Medium: Debug / test symbols left in production `app.bin`

| | |
|--|--|
| **Surface** | AC707N `app.bin` |
| **Evidence** | `JL_ble_test`, `jl_rcsp_ble_test`, `DBG_UART0/1/2`; client stack also knows optional log notify `7E400004` |
| **Impact** | Increases attack surface / info leak if test entry points remain reachable (needs live probing) |

### F7 — Medium: Server-controlled force-upgrade flag

| | |
|--|--|
| **Surface** | OTA catalog `force` field |
| **Evidence** | DG01 row observed with `force: 1`; API gated only by the static bearer (F1) |
| **Impact** | Compromised catalog/CDN can push mandatory upgrade/downgrade to clients using that token |

### F8 — Low: Watch-SDK leftovers (not a hidden C2)

| | |
|--|--|
| **Surface** | `app.bin` strings |
| **Evidence** | HFP `AT+*` table, heart/step/sleep/game tones, `mic_effect*`, QR to `jusonsmart` manual/download pages |
| **Impact** | Undocumented relative to badge UI; mostly dead OEM watch template residue |

## Undocumented / leftover surfaces

**Likely intentional product paths**

- GATT UART `7E40…` (badge control)
- JieLi `AE00` BLE OTA
- DIS `0x180A` / Battery `0x180F`
- QR → `app.jusonsmart.com` download / manual pages

**SDK residue (verify on-device)**

- Classic BT HFP AT command table
- heart / step / sleep / game tone assets
- `mic_effect*`, `jl_rcsp_ble_test`
- Multi-transport OTA bin name table

## What we did not find

- No hardcoded reverse shell, Telnet/SSH listener, or cleartext “backdoor password” in `app.bin`
- No second unexplained C2 host beyond jusonsmart / gulaike product infrastructure and QR help URLs
- BLE OTA in the app enables RCSP auth — not a completely open `AE00` write without handshake (USB/UART still weaker)

## Operational notes for this repo’s clients

- BJ-1 drops GATT on Baji `MEDIA_*` and FitPro dial-info (`0x20`) probes — manager skips those; see [Dial upload](dial-upload.md)
- Do **not** flash LJ755/LJ760 or unrelated `LJ733B` cuts onto SuperBand badges
- Prefer GAP/DIS tags (`BJ-1`, `DG01`, `V32286`, …) when picking a zip

## Recommended live probes

| Probe | Goal |
|-------|------|
| nRF Connect: list `AE00` + `7E400004` on BJ-1 | Confirm OTA + log chars at runtime |
| Attempt `AE00` OTA without RCSP auth | Validate whether auth is enforced on device |
| USB JieLi downloader with chipkey `B165` | Confirm forced update still works on shipping HW |
| Fuzz FitPro modules beyond `0x1F` / `0x20` | Map undocumented command surface |

## Related

- [Firmware OTA](ota-firmware.md)
- [Firmware hardware](firmware-hw.md)
- [GATT](gatt.md)
- [Tools](../../tools/README.md) — `send-ota.sh`, `download-firmware.sh`
