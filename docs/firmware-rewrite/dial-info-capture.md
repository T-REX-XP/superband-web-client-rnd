# Dial-info capture (BJ-1)

## Goal

Record live FitPro dial-info (`0x20` / cmd `2`): **width/height**, **algorithm**, **shortPkgLength**, model strings — to lock the firmware contract and image encode path.

## Tool

```bash
python3 -m venv /tmp/superband-blevenv
/tmp/superband-blevenv/bin/pip install bleak
/tmp/superband-blevenv/bin/python tools/capture-dial-info.py
# or:
/tmp/superband-blevenv/bin/python tools/capture-dial-info.py --address AA:BB:… --name BJ-1
```

Output: `docs/firmware-rewrite/captures/<name>_<utc>.json`

Web path: Manager → **Advanced** → dial-info (opt-in). On success the UI downloads a JSON capture as well.

## Known stock behavior

- Auto dial-info on connect **drops GATT** on many BJ-1 units — manager skips it.
- Manual probe may still disconnect; capture JSON records `gattStillConnected` and raw frames.

## Capture log (this environment)

| When (UTC) | Result |
|------------|--------|
| 2026-08-11 | Advertising seen: GAP `BJ-1`, addr `B5:2F:EA:08:07:7A`, mfg `0xAA01`, RSSI ~−59. GATT **connect timed out** — see `captures/BJ-1_20260811T185208Z.json`. |
| — | Full dial-info PDU **not yet received** on this host; use inferred baseline until a connect succeeds. |

### Working defaults (until a successful 0x20 response)

Aligned with successful RGB565 pushes and `dg01-ble` / non-alg-4 FitPro path:

| Field | Value | Confidence |
|-------|------:|------------|
| width × height | 360 × 360 | High (product + client default) |
| algorithm | `0` (not `4`) | High (JPEG type 2 → black screen; RGB565 type 0 works) |
| dialType | `0` | High |
| shortPkgLength | `180` (web cap) | Medium (device may advertise larger) |
| encode | LE RGB565 | High |

See `captures/BJ-1_baseline_inferred.json` and re-run the tool when the badge accepts a connection.

## Related

- [Dial upload](../protocol/dial-upload.md)
- [Firmware contract](../protocol/firmware-contract.md)
