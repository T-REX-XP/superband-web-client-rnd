#!/usr/bin/env python3
"""Pure-Python FitPro dial31 acceptor — mirrors firmware/ac707n-open/src/dial31.c."""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field


def u16be(n: int) -> bytes:
    return bytes([(n >> 8) & 0xFF, n & 0xFF])


def u32be(n: int) -> bytes:
    return bytes([(n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF])


def get_u16be(b: bytes, o: int = 0) -> int:
    return (b[o] << 8) | b[o + 1]


def get_u32be(b: bytes, o: int = 0) -> int:
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) & 0xFFFFFFFF


def byte_sum(data: bytes) -> int:
    return sum(data) & 0xFFFFFFFF


def build_frame(module: int, cmd: int, payload: bytes = b"") -> bytes:
    total = 8 + len(payload)
    return bytes([0xCD]) + u16be(total - 3) + bytes([module & 0xFF, 0x01, cmd & 0xFF]) + u16be(len(payload)) + payload


@dataclass
class Dial31:
    charging: bool = False
    active: bool = False
    expect_size: int = 0
    received: int = 0
    next_seq: int = 1
    blob: bytearray = field(default_factory=bytearray)
    dial_type: int = 0
    last_status: list[int] = field(default_factory=list)

    def _status(self, code: int) -> bytes:
        self.last_status.append(code)
        return build_frame(0x20, 1, u32be(code))

    def on_frame(self, frame: bytes) -> list[bytes]:
        if len(frame) < 8 or frame[0] != 0xCD:
            return []
        mod, cmd = frame[3], frame[5]
        plen = get_u16be(frame, 6)
        payload = frame[8 : 8 + plen]
        out: list[bytes] = []
        if mod == 0x20 and cmd == 2:
            # Minimal dial-info: 360x360 alg 0 shortPkg 180
            info = bytearray()
            info += bytes([1, 0]) + u16be(360) + u16be(360)
            info += bytes([4]) + b"BJ-1"
            info += bytes([5]) + b"LJ733"
            info += bytes([0, 0])  # config, algorithm
            info += bytes([0, 0, 0, 0, 0])  # pad to customer
            info += bytes([0, 0, 1]) + u16be(1) + u16be(180)
            out.append(build_frame(0x20, 2, bytes(info)))
            return out
        if mod == 0x20 and cmd == 1:
            code = 1000 + self.next_seq - 1 if self.active else 2
            out.append(self._status(code))
            return out
        if mod != 0x1F:
            return out
        if cmd == 2:  # start
            if self.charging:
                out.append(self._status(4))
                return out
            if len(payload) < 14:
                out.append(self._status(1))
                return out
            self.dial_type = payload[4]
            self.expect_size = get_u32be(payload, 9)
            self.blob = bytearray()
            self.received = 0
            self.next_seq = 1
            self.active = True
            out.append(self._status(1000))
        elif cmd == 1:  # data
            if not self.active or len(payload) < 6:
                out.append(self._status(1))
                return out
            seq = get_u16be(payload, 0)
            chunk = payload[2:-4]
            declared = get_u32be(payload, 2 + len(chunk))
            if byte_sum(payload[: 2 + len(chunk)]) != declared or seq != self.next_seq:
                self.active = False
                out.append(self._status(1))
                return out
            self.blob.extend(chunk)
            self.received += len(chunk)
            self.next_seq += 1
            out.append(self._status(1000 + seq))
        elif cmd == 3:  # finish
            if not self.active or len(payload) < 4:
                out.append(self._status(1))
                return out
            want = get_u32be(payload, 0)
            if want != byte_sum(self.blob) or self.received != self.expect_size:
                self.active = False
                out.append(self._status(1))
                return out
            self.active = False
            out.append(self._status(2))
        return out


def self_test() -> None:
    d = Dial31()
    # start tiny blob
    blob = b"\x00\x00\x00\x04" + b"TEST"
    start_payload = u32be(5538) + bytes([0, 0x08, 0, 0, 0]) + u32be(len(blob)) + bytes(4)
    rs = d.on_frame(build_frame(0x1F, 2, start_payload))
    assert get_u32be(rs[0], 8) == 1000
    chunk = blob
    head = u16be(1) + chunk
    data_payload = head + u32be(byte_sum(head))
    rs = d.on_frame(build_frame(0x1F, 1, data_payload))
    assert get_u32be(rs[0], 8) == 1001
    rs = d.on_frame(build_frame(0x1F, 3, u32be(byte_sum(blob))))
    assert get_u32be(rs[0], 8) == 2
    # dial-info must answer (open FW must not drop link)
    rs = d.on_frame(build_frame(0x20, 2))
    assert rs and rs[0][3] == 0x20 and rs[0][5] == 2
    print("dial31_sim self-test OK")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--stdio", action="store_true", help="read hex frames from stdin")
    args = ap.parse_args()
    if args.self_test or not args.stdio:
        self_test()
        if not args.stdio:
            return 0
    d = Dial31()
    for line in sys.stdin:
        line = line.strip().replace(" ", "")
        if not line:
            continue
        frame = bytes.fromhex(line)
        for resp in d.on_frame(frame):
            print(resp.hex())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
