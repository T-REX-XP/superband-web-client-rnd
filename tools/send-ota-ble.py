#!/usr/bin/env python3
"""
BLE OTA helper for SuperBand / JieLi AE00 (RCSP).

Preferred backend: openwearota (JieLi RCSP flash over bleak).
Fallback: discover AE00 service and report readiness (no payload send).

Usage:
  python3 tools/send-ota-ble.py scan
  python3 tools/send-ota-ble.py flash --address AA:BB:CC:DD:EE:FF --ufw path/to/app.ufw
"""
from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
import sys
from pathlib import Path

AE00 = "0000ae00-0000-1000-8000-00805f9b34fb"
AE01 = "0000ae01-0000-1000-8000-00805f9b34fb"
AE02 = "0000ae02-0000-1000-8000-00805f9b34fb"
UART = "7e400001-b5a3-f393-e0a9-e50e24dcca9d"


def have_openwearota() -> str | None:
    return shutil.which("openwearota")


async def scan_bleak(timeout: float) -> int:
    try:
        from bleak import BleakScanner
    except ImportError:
        print("bleak not installed. Create venv:", file=sys.stderr)
        print("  python3 -m venv tools/.venv-ota && tools/.venv-ota/bin/pip install bleak openwearota", file=sys.stderr)
        return 2

    print(f"Scanning {timeout:.0f}s…")
    devices = await BleakScanner.discover(timeout=timeout)
    rows = []
    for d in devices:
        name = d.name or ""
        if not name and hasattr(d, "metadata"):
            name = ""
        interesting = bool(
            name
            and (
                name.startswith(("BJ", "DG", "_V"))
                or "Badge" in name
                or "SuperBand" in name
                or "Watch" in name
            )
        )
        rows.append((interesting, d.address, name or "(no name)", getattr(d, "rssi", "?")))
    rows.sort(key=lambda r: (not r[0], r[2]))
    for interesting, addr, name, rssi in rows:
        mark = "*" if interesting else " "
        print(f"{mark} {addr}  rssi={rssi}  {name}")
    print(f"\n{len(rows)} device(s). '*' = name looks like badge / watch.")
    return 0


async def probe_ae00(address: str, timeout: float) -> int:
    try:
        from bleak import BleakClient
    except ImportError:
        print("bleak not installed — see send-ota.sh --help", file=sys.stderr)
        return 2

    print(f"Connecting {address}…")
    async with BleakClient(address, timeout=timeout) as client:
        if not client.is_connected:
            print("Failed to connect", file=sys.stderr)
            return 1
        services = client.services
        uuids = {str(s.uuid).lower() for s in services}
        print("Services:")
        for s in services:
            print(f"  {s.uuid}")
            for c in s.characteristics:
                props = ",".join(c.properties)
                print(f"    {c.uuid}  [{props}]")
        has_ota = AE00 in uuids
        has_uart = any(u.startswith("7e400001") for u in uuids)
        print()
        print(f"JieLi OTA AE00: {'YES' if has_ota else 'NO'}")
        print(f"UART 7E40…:     {'YES' if has_uart else 'NO'}")
        if not has_ota:
            print("Device does not expose AE00 — cannot BLE-OTA with this helper.", file=sys.stderr)
            return 3
        return 0


def flash_openwearota(address: str, ufw: Path) -> int:
    exe = have_openwearota()
    if not exe:
        print("openwearota not on PATH.", file=sys.stderr)
        print("Install:", file=sys.stderr)
        print("  python3 -m venv tools/.venv-ota", file=sys.stderr)
        print("  tools/.venv-ota/bin/pip install -U pip bleak openwearota", file=sys.stderr)
        print("Then re-run with that venv's python, or:", file=sys.stderr)
        print(f"  {sys.executable} -m pip install openwearota", file=sys.stderr)
        return 2
    cmd = [exe, "flash", address, str(ufw)]
    print("==>", " ".join(cmd))
    print("WARNING: openwearota JieLi path is alpha; AC707N may differ from AC695/AC696.")
    print("         Wrong image can brick the badge. Prefer matching BJ-1 / DG01 zip tags.")
    return subprocess.call(cmd)


def main() -> int:
    p = argparse.ArgumentParser(description="SuperBand / JieLi BLE OTA helper")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scan", help="Scan BLE advertisements")
    s.add_argument("--timeout", type=float, default=8.0)

    pr = sub.add_parser("probe", help="Connect and check AE00 / UART services")
    pr.add_argument("--address", required=True)
    pr.add_argument("--timeout", type=float, default=20.0)

    f = sub.add_parser("flash", help="Flash .ufw via openwearota (JieLi RCSP)")
    f.add_argument("--address", required=True)
    f.add_argument("--ufw", required=True, type=Path)
    f.add_argument("--probe-first", action="store_true", help="Probe AE00 before flashing")

    args = p.parse_args()
    if args.cmd == "scan":
        return asyncio.run(scan_bleak(args.timeout))
    if args.cmd == "probe":
        return asyncio.run(probe_ae00(args.address, args.timeout))
    if args.cmd == "flash":
        ufw = args.ufw.expanduser().resolve()
        if not ufw.is_file():
            print(f"UFW not found: {ufw}", file=sys.stderr)
            return 1
        if args.probe_first:
            rc = asyncio.run(probe_ae00(args.address, 20.0))
            if rc != 0:
                return rc
        return flash_openwearota(args.address, ufw)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
