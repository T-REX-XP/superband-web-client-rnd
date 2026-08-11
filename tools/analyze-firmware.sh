#!/usr/bin/env bash
# Unpack / string-analyze JieLi SuperBand UFW packages → research/firmware/analysis/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FW="${ROOT}/research/firmware"
OUT="${ROOT}/research/firmware/analysis"
PRESET=""
UFW_PATH=""
VENV="${TMPDIR:-/tmp}/superband-jlvenv"
JL_REPO="${TMPDIR:-/tmp}/jl-misctools"

usage() {
  cat <<'EOF'
Usage: ./tools/analyze-firmware.sh [options]

Options:
  --preset dg01|bj1   Analyze a known downloaded package
  --ufw PATH          Analyze a specific app.ufw
  --out DIR           Analysis output root (default: research/firmware/analysis)
  -h, --help

Examples:
  ./tools/download-firmware.sh --preset dg01
  ./tools/analyze-firmware.sh --preset dg01
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preset) PRESET="$2"; shift 2 ;;
    --ufw) UFW_PATH="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

case "${PRESET}" in
  dg01|DG01)
    UFW_PATH="${FW}/lj733_dg01_extract/app.ufw"
    LABEL=dg01
    if [[ ! -f "${UFW_PATH}" ]]; then
      echo "Missing ${UFW_PATH} — run: ./tools/download-firmware.sh --preset dg01" >&2
      exit 1
    fi
    ;;
  bj1|BJ1|bj-1|BJ-1)
    LABEL=bj1
    ZIP="${FW}/V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip"
    if [[ ! -f "${ZIP}" ]]; then
      # try any *BJ-1* zip
      ZIP="$(ls -t "${FW}"/*BJ-1*.zip 2>/dev/null | head -n1 || true)"
    fi
    if [[ -z "${ZIP}" || ! -f "${ZIP}" ]]; then
      echo "Missing BJ-1 zip — run: ./tools/download-firmware.sh --preset bj1" >&2
      exit 1
    fi
    mkdir -p "${FW}/bj1_extract"
    unzip -o -q "${ZIP}" -d "${FW}/bj1_extract"
    UFW_PATH="${FW}/bj1_extract/app.ufw"
    ;;
  "")
    if [[ -z "${UFW_PATH}" ]]; then usage; exit 1; fi
    LABEL="$(basename "$(dirname "${UFW_PATH}")")"
    ;;
  *)
    echo "Unknown preset: ${PRESET}" >&2
    exit 1
    ;;
esac

if [[ ! -f "${UFW_PATH}" ]]; then
  echo "UFW not found: ${UFW_PATH}" >&2
  exit 1
fi

mkdir -p "${OUT}"
UNPACK="${OUT}/${LABEL}_unpack"
rm -rf "${UNPACK}"

echo "==> target ${UFW_PATH}"
echo "==> ensuring jl-misctools + venv"

if [[ ! -d "${JL_REPO}/.git" ]]; then
  git clone --depth 1 https://github.com/kagaimiq/jl-misctools.git "${JL_REPO}"
fi
if [[ ! -x "${VENV}/bin/python" ]]; then
  python3 -m venv "${VENV}"
  "${VENV}/bin/pip" install -q crcmod pyyaml
fi

echo "==> unpack → ${UNPACK}"
PYTHONPATH="${JL_REPO}/firmware" "${VENV}/bin/python" \
  "${JL_REPO}/firmware/fwunpack_newfw.py" "${UFW_PATH}" \
  --dirname "${UNPACK}" | tee "${OUT}/${LABEL}_unpack.log"

echo "==> string summary"
python3 << PY
from pathlib import Path
import re, json, hashlib
root = Path("${UNPACK}")
app = (root/"files"/"app.bin").read_bytes()
cfg = (root/"files"/"cfg_tool.bin").read_bytes()
isd = (root/"top"/"isd_config.ini").read_bytes()
def S(b,n=4):
    return [m.decode("ascii","ignore") for m in re.findall(rb"[\\x20-\\x7e]{"+str(n).encode()+rb",}", b)]
keys = ("AC707","JL707","cst816","lcd_","tp_","gpu","PSRAM","AVI","JPEG","BLE","BR22","watch")
interesting=[]
for s in S(app,5):
    if any(k.lower() in s.lower() for k in keys):
        interesting.append(s)
seen=set(); uniq=[]
for s in interesting:
    if s not in seen and len(s)<100:
        seen.add(s); uniq.append(s)
summary={
  "label": "${LABEL}",
  "ufw": "${UFW_PATH}",
  "chip_from_cfg_tool": [s for s in S(cfg,3) if "AC707" in s or "JL707" in s or s=="watch"],
  "sdk_banner": [s for s in S(app,8) if s.startswith("AC707N_")],
  "touch": [s for s in S(app,6) if "cst816" in s.lower() or s.startswith("tp_")],
  "display": [s for s in S(app,6) if s.startswith("lcd_") or "gpu" in s.lower()],
  "isd_strings": S(isd,3),
  "app_sha256": hashlib.sha256(app).hexdigest(),
  "app_bytes": len(app),
  "interesting": uniq[:40],
}
out = Path("${OUT}")/"${LABEL}_summary.json"
out.write_text(json.dumps(summary, indent=2)+"\\n")
print(json.dumps(summary, indent=2))
print("wrote", out)
PY

echo "Done. See docs/protocol/firmware-hw.md"
