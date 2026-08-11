#!/usr/bin/env bash
# Unpack SuperBand .apks into research/unpacked/ and optionally decompile with jadx.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APKS=""
OUT_APKS="${ROOT}/research/unpacked/apks"
OUT_JADX="${ROOT}/research/unpacked/jadx"
RUN_JADX=1
CLEAN=0

usage() {
  cat <<'EOF'
Usage: ./tools/unpack-apk.sh [options]

Options:
  --apks PATH     Path to .apks / .apk (default: newest artifacts/*.apks)
  --out-apks DIR  Extract directory (default: research/unpacked/apks)
  --out-jadx DIR  jadx output (default: research/unpacked/jadx)
  --no-jadx       Only unzip the bundle (skip decompile)
  --clean         Remove existing extract/jadx dirs before writing
  -h, --help      Show this help

Examples:
  ./tools/unpack-apk.sh
  ./tools/unpack-apk.sh --apks artifacts/SuperBand_2.1.25_apkcube.apks
  ./tools/unpack-apk.sh --no-jadx
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apks) APKS="$2"; shift 2 ;;
    --out-apks) OUT_APKS="$2"; shift 2 ;;
    --out-jadx) OUT_JADX="$2"; shift 2 ;;
    --no-jadx) RUN_JADX=0; shift ;;
    --clean) CLEAN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "${APKS}" ]]; then
  if compgen -G "${ROOT}/artifacts/*.apks" >/dev/null; then
    APKS="$(ls -t "${ROOT}/artifacts"/*.apks | head -n1)"
  elif compgen -G "${ROOT}/artifacts/*.apk" >/dev/null; then
    APKS="$(ls -t "${ROOT}/artifacts"/*.apk | head -n1)"
  else
    echo "No artifacts/*.apks found. Place the SuperBand bundle under artifacts/ or pass --apks." >&2
    exit 1
  fi
fi

if [[ ! -f "${APKS}" ]]; then
  echo "File not found: ${APKS}" >&2
  exit 1
fi

echo "==> source ${APKS}"

if [[ "${CLEAN}" -eq 1 ]]; then
  rm -rf "${OUT_APKS}" "${OUT_JADX}"
fi

mkdir -p "${OUT_APKS}"

case "${APKS}" in
  *.apks|*.zip)
    echo "==> unzip → ${OUT_APKS}"
    unzip -o "${APKS}" -d "${OUT_APKS}"
    ;;
  *.apk)
    echo "==> copy apk → ${OUT_APKS}/base.apk"
    cp -f "${APKS}" "${OUT_APKS}/base.apk"
    ;;
  *)
    echo "Unsupported file type: ${APKS}" >&2
    exit 1
    ;;
esac

BASE_APK="${OUT_APKS}/base.apk"
if [[ ! -f "${BASE_APK}" ]]; then
  # Some bundles nest the apk
  BASE_APK="$(find "${OUT_APKS}" -type f -name 'base.apk' | head -n1 || true)"
fi
if [[ -z "${BASE_APK}" || ! -f "${BASE_APK}" ]]; then
  echo "base.apk not found under ${OUT_APKS}" >&2
  exit 1
fi
echo "    base.apk → ${BASE_APK} ($(wc -c <"${BASE_APK}" | tr -d ' ') bytes)"

if [[ "${RUN_JADX}" -eq 1 ]]; then
  if ! command -v jadx >/dev/null 2>&1; then
    echo "jadx not on PATH — skipping decompile. Install jadx or re-run without needing sources." >&2
    echo "Done (apk extract only)."
    exit 0
  fi
  echo "==> jadx → ${OUT_JADX}"
  mkdir -p "${OUT_JADX}"
  jadx -d "${OUT_JADX}" --show-bad-code --no-res "${BASE_APK}"
  echo "    sources under ${OUT_JADX}/sources"
fi

echo "Done. See docs/rnd-investigation.md for key packages."
