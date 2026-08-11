#!/usr/bin/env python3
"""
Live FitPro dial-info capture for BJ-1 / DG* badges over BLE UART.

Connects to GATT 7E40…, enables notify, optionally sends legacy pair + 0x1A probes,
then requests dial-info (0x20 / cmd 2). Saves JSON under docs/firmware-rewrite/captures/.

Requires: pip install bleak  (use a venv; see docs/firmware-rewrite/dial-info-capture.md)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs/firmware-rewrite/captures"

UART_SERVICE = "7e400001-b5a3-f393-e0a9-e50e24dcca9d"
UART_WRITE = "7e400002-b5a3-f393-e0a9-e50e24dcca9d"
UART_NOTIFY = "7e400003-b5a3-f393-e0a9-e50e24dcca9d"
DIS_FW = "00002a26-0000-1000-8000-00805f9b34fb"
DIS_MODEL = "00002a24-0000-1000-8000-00805f9b34fb"
DIS_HW = "00002a27-0000-1000-8000-00805f9b34fb"
BATT = "00002a19-0000-1000-8000-00805f9b34fb"


def u16be(n: int) -> bytes:
    return bytes([(n >> 8) & 0xFF, n & 0xFF])


def get_u16be(b: bytes, o: int) -> int:
    return (b[o] << 8) | b[o + 1]


def get_u32be(b: bytes, o: int) -> int:
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) & 0xFFFFFFFF


def build_fitpro(module_id: int, cmd: int, payload: bytes = b"") -> bytes:
    n = len(payload)
    total = 8 + n
    out = bytearray(total)
    out[0] = 0xCD
    out[1:3] = u16be(total - 3)
    out[3] = module_id & 0xFF
    out[4] = 0x01
    out[5] = cmd & 0xFF
    out[6:8] = u16be(n)
    if n:
        out[8:] = payload
    return bytes(out)


def parse_dial_info(payload: bytes) -> dict | None:
    if not payload or len(payload) < 6:
        return None
    try:
        screen_type = payload[0]
        grade = payload[1]
        width = get_u16be(payload, 2)
        height = get_u16be(payload, 4)
        o = 6
        mch_len = payload[o]
        o += 1
        if o + mch_len > len(payload):
            return None
        mch = payload[o : o + mch_len].decode("utf-8", errors="replace")
        o += mch_len
        main_len = payload[o]
        o += 1
        if o + main_len > len(payload):
            return None
        main = payload[o : o + main_len].decode("utf-8", errors="replace")
        o += main_len
        config = payload[o] if o < len(payload) else 0
        algorithm = payload[o + 1] if o + 1 < len(payload) else 0
        i6 = o
        i12 = i6 + 5
        customer_len = payload[i12] if len(payload) > i12 else 0
        i13 = i12 + customer_len
        picture_nums = payload[i13 + 1] if len(payload) > i13 + 1 else 0
        theme_version = get_u16be(payload, i13 + 2) if len(payload) >= i13 + 4 else 0
        short_pkg = get_u16be(payload, i13 + 4) if len(payload) >= i13 + 6 else 0
        return {
            "screenType": screen_type,
            "grade": grade,
            "width": width,
            "height": height,
            "mchModel": mch,
            "mainModel": main,
            "config": config,
            "algorithm": algorithm,
            "pictureNums": picture_nums,
            "themeVersion": theme_version,
            "shortPkgLength": short_pkg,
            "dialType": 2 if algorithm == 4 else 0,
            "jpeg": algorithm == 4,
            "rawPayloadHex": payload.hex(),
        }
    except Exception:
        return None


def looks_like_badge(name: str | None) -> bool:
    if not name:
        return False
    return bool(re.search(r"^(BJ|DG)|BadgeOK|SuperBand|_V\d", name, re.I))


async def discover_badge(timeout: float) -> tuple[str, str]:
    from bleak import BleakScanner

    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    best = None
    for addr, (dev, adv) in found.items():
        name = dev.name or adv.local_name or ""
        rssi = adv.rssi if adv.rssi is not None else -999
        mfg = adv.manufacturer_data or {}
        if looks_like_badge(name) or 0xAA01 in mfg:
            cand = (rssi, addr, name or "?")
            if best is None or cand[0] > best[0]:
                best = cand
    if not best:
        raise SystemExit("no BJ/DG / mfg 0xAA01 badge in range")
    return best[1], best[2]


async def read_optional(client, uuid: str) -> str | None:
    try:
        raw = await client.read_gatt_char(uuid)
        return raw.decode("utf-8", errors="replace").strip("\x00") or raw.hex()
    except Exception:
        return None


async def capture(address: str | None, name_hint: str | None, timeout: float, skip_info: bool) -> dict:
    from bleak import BleakClient, BleakScanner

    if not address:
        address, name_hint = await discover_badge(timeout)
        print(f"found {name_hint!r} @ {address}", file=sys.stderr)

    frames: list[dict] = []
    dial_info = None
    disconnected = asyncio.Event()

    def on_notify(_handle, data: bytearray):
        nonlocal dial_info
        b = bytes(data)
        row = {"t": time.time(), "hex": b.hex(), "len": len(b)}
        if len(b) >= 8 and b[0] == 0xCD:
            mod = b[3]
            cmd = b[5]
            plen = get_u16be(b, 6)
            payload = b[8 : 8 + plen]
            row.update({"module": mod, "cmd": cmd, "payloadHex": payload.hex()})
            if mod == 0x20 and cmd == 2:
                parsed = parse_dial_info(payload)
                if parsed:
                    dial_info = parsed
                    row["parsed"] = parsed
        frames.append(row)

    async with BleakClient(address, timeout=timeout) as client:
        meta = {
            "address": address,
            "name": name_hint,
            "connected": client.is_connected,
            "dis": {
                "firmware": await read_optional(client, DIS_FW),
                "model": await read_optional(client, DIS_MODEL),
                "hardware": await read_optional(client, DIS_HW),
            },
        }
        try:
            batt = await client.read_gatt_char(BATT)
            meta["battery"] = batt[0] if batt else None
        except Exception:
            meta["battery"] = None

        await client.start_notify(UART_NOTIFY, on_notify)
        await asyncio.sleep(0.2)

        # Legacy pair (best-effort)
        await client.write_gatt_char(UART_WRITE, bytes.fromhex("cd000612010a000102"), response=False)
        await asyncio.sleep(0.15)
        for cmd in (10, 12, 28):
            await client.write_gatt_char(UART_WRITE, build_fitpro(0x1A, cmd), response=False)
            await asyncio.sleep(0.1)

        if not skip_info:
            print("sending DIAL_INFO (0x20/2) — may drop GATT on stock BJ-1", file=sys.stderr)
            await client.write_gatt_char(UART_WRITE, build_fitpro(0x20, 2), response=False)
            # Wait for response or disconnect
            for _ in range(40):
                if dial_info is not None:
                    break
                if not client.is_connected:
                    break
                await asyncio.sleep(0.15)

        await asyncio.sleep(0.3)
        try:
            await client.stop_notify(UART_NOTIFY)
        except Exception:
            pass

        meta["gattStillConnected"] = client.is_connected
        meta["dialInfo"] = dial_info
        meta["frames"] = frames
        meta["capturedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        meta["note"] = (
            "Stock BJ-1 often disconnects on 0x20 dial-info; "
            "absence of dialInfo with gattStillConnected=false is expected."
        )
        return meta


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--address", help="BLE MAC / address")
    ap.add_argument("--name", help="GAP name hint for output")
    ap.add_argument("--timeout", type=float, default=12.0)
    ap.add_argument("--skip-info", action="store_true", help="Only DIS + handshake (no 0x20)")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    try:
        from bleak import BleakClient  # noqa: F401
    except ImportError:
        raise SystemExit("bleak not installed — create venv and pip install bleak")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    try:
        result = asyncio.run(capture(args.address, args.name, args.timeout, args.skip_info))
    except TimeoutError as e:
        result = {
            "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "address": args.address,
            "name": args.name,
            "error": "GATT connect timeout",
            "detail": str(e) or "TimeoutError",
            "dialInfo": None,
            "note": "Badge may be asleep, out of range for connect, or connected to another central.",
        }
    except Exception as e:
        result = {
            "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "address": args.address,
            "name": args.name,
            "error": type(e).__name__,
            "detail": str(e),
            "dialInfo": None,
        }

    name = (result.get("name") or "badge").replace("/", "_")
    out = args.out or (OUT_DIR / f"{name}_{stamp}.json")
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(f"wrote {out}")
    info = result.get("dialInfo")
    if info:
        print(
            f"dial-info: {info['width']}x{info['height']} alg={info['algorithm']} "
            f"shortPkg={info['shortPkgLength']} mch={info['mchModel']!r}"
        )
        return 0
    print(
        "dial-info: NOT RECEIVED "
        f"(error={result.get('error')!r} connected_after={result.get('gattStillConnected')} "
        f"frames={len(result.get('frames') or [])})"
    )
    if result.get("dis"):
        print("DIS:", json.dumps(result.get("dis"), indent=2))
    return 0 if args.skip_info else 2


if __name__ == "__main__":
    raise SystemExit(main())
