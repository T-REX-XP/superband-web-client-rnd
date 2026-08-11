#!/usr/bin/env python3
"""
Static map of FitPro dial modules (0x1F / 0x20) inside BJ-1 / DG01 app.bin.

No Ghidra required: string xref + immediate / frame-byte pattern scan.
Writes JSON + markdown under --out (default: docs/firmware-rewrite/).
"""
from __future__ import annotations

import argparse
import json
import re
import struct
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APP = ROOT / "research/firmware/analysis/bj1_unpack/files/app.bin"
DEFAULT_OUT = ROOT / "docs/firmware-rewrite"

INTERESTING_STRINGS = [
    b"watch.sty",
    b"res_nor_dial",
    b"JLHWJPEG",
    b"jpeg_decode",
    b"BmpConvert",
    b"tp_cst816d",
    b"lcd_init",
    b"lcd_backlight",
    b"storage/nor_ui",
    b"bgp_wa",
    b"AC707N",
    b"JLOTA",
    b"ble_ota",
    b"watchTheme",
    b"WatchTheme",
    b"dial",
    b"DIAL",
]


def find_strings(blob: bytes, min_len: int = 4) -> list[tuple[int, str]]:
    out = []
    for m in re.finditer(rb"[\x20-\x7e]{%d,}" % min_len, blob):
        out.append((m.start(), m.group().decode("ascii", errors="ignore")))
    return out


def find_all(blob: bytes, needle: bytes) -> list[int]:
    hits = []
    start = 0
    while True:
        i = blob.find(needle, start)
        if i < 0:
            break
        hits.append(i)
        start = i + 1
    return hits


def scan_fitpro_literals(blob: bytes) -> dict:
    """Look for CD|len|module|01|cmd style immediates and status constants."""
    # Short request frames embedded as constants (rare but useful)
    patterns = {
        "dial_info_req_cd200102": find_all(blob, bytes.fromhex("cd00052001020000")),
        "dial_status_req_cd200101": find_all(blob, bytes.fromhex("cd00052001010000")),
        "legacy_pair_cd12010a": find_all(blob, bytes.fromhex("cd000612010a000102")),
    }

    # Module/cmd immediates in little-endian Thumb-ish neighborhoods:
    # count standalone 0x1f / 0x20 bytes is useless; instead look for
    # sequences: 1F 01 02 / 1F 01 01 / 1F 01 03 / 20 01 02 / 20 01 01
    seqs = {
        "mod1f_cmd_data": find_all(blob, b"\x1f\x01\x01"),
        "mod1f_cmd_start": find_all(blob, b"\x1f\x01\x02"),
        "mod1f_cmd_finish": find_all(blob, b"\x1f\x01\x03"),
        "mod20_cmd_status": find_all(blob, b"\x20\x01\x01"),
        "mod20_cmd_info": find_all(blob, b"\x20\x01\x02"),
        "mod1a_legacy": find_all(blob, b"\x1a\x01"),
    }

    # Status band 1000 (0x03E8) as BE and LE dwords near dial logic
    status_be = find_all(blob, struct.pack(">I", 1000))
    status_le = find_all(blob, struct.pack("<I", 1000))
    status_ok_context = []
    # Look for small jump tables of status codes 1..9 near 1000
    for off in status_le[:40]:
        window = blob[max(0, off - 32) : off + 48]
        codes = [window[i] for i in range(len(window)) if window[i] in (1, 2, 3, 4, 5, 6, 7, 8, 9)]
        status_ok_context.append({"offset": off, "nearby_small_bytes": codes[:16]})

    return {
        "embedded_frames": {k: v[:32] for k, v in patterns.items()},
        "module_cmd_triplets": {k: {"count": len(v), "offsets_sample": v[:24]} for k, v in seqs.items()},
        "status_1000_be_count": len(status_be),
        "status_1000_le_count": len(status_le),
        "status_1000_le_sample": status_ok_context[:12],
    }


def string_hits(blob: bytes) -> list[dict]:
    rows = []
    for needle in INTERESTING_STRINGS:
        for off in find_all(blob, needle)[:8]:
            # grab surrounding printable run
            lo = off
            while lo > 0 and 32 <= blob[lo - 1] <= 126:
                lo -= 1
            hi = off
            while hi < len(blob) and 32 <= blob[hi] <= 126:
                hi += 1
            rows.append(
                {
                    "needle": needle.decode("ascii", errors="ignore"),
                    "offset": off,
                    "string": blob[lo:hi].decode("ascii", errors="ignore")[:120],
                }
            )
    return rows


def dial_id_hits(blob: bytes) -> dict:
    # Picture dial id 5538 = 0x15A2
    be = find_all(blob, struct.pack(">I", 5538))
    le = find_all(blob, struct.pack("<I", 5538))
    be16 = find_all(blob, struct.pack(">H", 5538))
    le16 = find_all(blob, struct.pack("<H", 5538))
    return {
        "5538_u32be": be[:16],
        "5538_u32le": le[:16],
        "5538_u16be": be16[:16],
        "5538_u16le": le16[:16],
    }


def compare_bins(a: bytes, b: bytes) -> dict:
    if len(a) != len(b):
        return {"same_size": False, "len_a": len(a), "len_b": len(b)}
    diff = sum(1 for x, y in zip(a, b) if x != y)
    return {
        "same_size": True,
        "len": len(a),
        "diff_bytes": diff,
        "diff_pct": round(100.0 * diff / len(a), 3),
    }


def render_md(report: dict) -> str:
    lit = report["literals"]
    lines = [
        "# FitPro dispatch map (`app.bin` static RE)",
        "",
        f"Source: `{report['app_path']}` ({report['app_size']} bytes)",
        f"Compared DG01: {json.dumps(report.get('dg01_diff', {}))}",
        "",
        "## Verdict",
        "",
        "Stock `app.bin` is a stripped AC707N image. This pass does **not** recover C source;",
        "it locates FitPro module/command immediates, status constant `1000`, dial id `5538`,",
        "and UI/decode strings that anchor a Ghidra project.",
        "",
        "## Embedded / triplet hits",
        "",
        "### Module·cmd triplets (`module | 0x01 | cmd`)",
        "",
        "| Pattern | Count | Sample offsets |",
        "|---------|------:|----------------|",
    ]
    for name, row in lit["module_cmd_triplets"].items():
        sample = ", ".join(f"0x{o:x}" for o in row["offsets_sample"][:8]) or "—"
        lines.append(f"| `{name}` | {row['count']} | {sample} |")
    lines += [
        "",
        "### Status constant 1000 (`0x03E8`)",
        "",
        f"- LE dword count: **{lit['status_1000_le_count']}**",
        f"- BE dword count: **{lit['status_1000_be_count']}**",
        "",
        "Chunk ACK band in the host protocol is `1000 + seq` (see `docs/protocol/dial-upload.md`).",
        "LE hits are the primary Ghidra seeds for the upgrade-status emitter.",
        "",
        "### Picture dial id 5538",
        "",
        "```json",
        json.dumps(report["dial_id"], indent=2),
        "```",
        "",
        "## Interesting strings (xref seeds)",
        "",
        "| Offset | Needle | String |",
        "|-------:|--------|--------|",
    ]
    for row in report["strings"][:60]:
        s = row["string"].replace("|", "\\|")
        lines.append(f"| `0x{row['offset']:x}` | `{row['needle']}` | `{s}` |")
    lines += [
        "",
        "## Suggested Ghidra workflow",
        "",
        "1. Load `app.bin` as raw ARM (entry hint `0x0C000100` from UFW / `isd_config`).",
        "2. Navigate to LE `1000` hits and `1f 01 02` / `20 01 01` triplets; define functions upward.",
        "3. Cross-ref `JLHWJPEG` / `jpeg_decode` / `lcd_*` / `res_nor_dial` strings for the image path.",
        "4. Mark dispatch: UART RX → parse `CD` frame → switch(module) → `0x1F`/`0x20` handlers.",
        "5. Confirm status codes `1..9` and `1000+n` writers feed notify characteristic `7E400003`.",
        "",
        "## Clean-room implication",
        "",
        "Open firmware should **reimplement** the host-visible contract in",
        "`docs/protocol/firmware-contract.md` rather than transplanting these offsets.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--app", type=Path, default=DEFAULT_APP)
    ap.add_argument("--dg01", type=Path, default=ROOT / "research/firmware/analysis/dg01_unpack/files/app.bin")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    if not args.app.is_file():
        raise SystemExit(f"missing app.bin: {args.app} (run ./tools/analyze-firmware.sh --preset bj1)")

    blob = args.app.read_bytes()
    report = {
        "app_path": str(args.app.relative_to(ROOT)) if args.app.is_relative_to(ROOT) else str(args.app),
        "app_size": len(blob),
        "literals": scan_fitpro_literals(blob),
        "dial_id": dial_id_hits(blob),
        "strings": string_hits(blob),
    }
    if args.dg01.is_file():
        report["dg01_diff"] = compare_bins(blob, args.dg01.read_bytes())

    args.out.mkdir(parents=True, exist_ok=True)
    json_path = args.out / "re-fitpro-dispatch.json"
    md_path = args.out / "re-fitpro-dispatch.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n")
    md_path.write_text(render_md(report))
    print(f"wrote {json_path}")
    print(f"wrote {md_path}")
    trip = report["literals"]["module_cmd_triplets"]
    print("triplet counts:", {k: v["count"] for k, v in trip.items()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
