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

The capture tool reassembles split notifications before decoding dial-info. The manager also reads this profile on BJ-1 and BG-series connections.

## Capture log (this environment)

| When (UTC) | Result |
|------------|--------|
| 2026-08-11 | Advertising seen: GAP `BJ-1`, addr `B5:2F:EA:08:07:7A`, mfg `0xAA01`, RSSI ~−59. GATT **connect timed out** — see `captures/BJ-1_20260811T185208Z.json`. |
| 2026-11-25 | BJ-1 V32286 replied in two 20-byte notifications and GATT remained connected. |

### Measured V32286 profile

| Field | Value |
|-------|-------|
| Dimensions | 360 × 360 |
| Device models | K66 / LJ733 |
| Algorithm | 3 |
| Theme version | 9 |
| Logical short-packet size | 25,000 bytes |

The prior inferred profile in `captures/BJ-1_baseline_inferred.json` is retained as historical context.

Raw dial-info payload:

```text
010001680168034b3636054c4a3733330703fffe01054a5130303100000961a8
```

## Related

- [Dial upload](../protocol/dial-upload.md)
- [Firmware contract](../protocol/firmware-contract.md)
