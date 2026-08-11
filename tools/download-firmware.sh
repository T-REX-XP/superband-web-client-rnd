#!/usr/bin/env bash
# Download SuperBand / LJ733 OTA zips into research/firmware/ and unpack app.ufw.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/research/firmware"
PRESET=""
VERSION=""
NAME="DG01"
URL=""
SKIP_UNPACK=0

usage() {
  cat <<'EOF'
Usage: ./tools/download-firmware.sh [options]

Options:
  --preset dg01|bj1|all   Download known CDN packages
  --version Vxxxxx        Probe tomato catalog and download if offered
  --name NAME             Bluetooth / catalog name for probe (default: DG01)
  --url URL               Download a specific zip URL
  --out DIR               Output directory (default: research/firmware)
  --skip-unpack           Keep zip only (do not extract app.ufw)
  -h, --help              Show this help

Examples:
  ./tools/download-firmware.sh --preset all
  ./tools/download-firmware.sh --preset bj1
  ./tools/download-firmware.sh --version V32294 --name BJ-1
EOF
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

download_one() {
  local url="$1"
  local label="${2:-}"
  local base
  base="$(basename "${url%%\?*}")"
  # Decode %2B etc. in filenames for local storage
  base="$(printf '%b' "${base//%/\\x}")"
  local zip="${OUT}/${base}"
  mkdir -p "${OUT}"
  echo "==> ${label:-download} ${url}"
  curl -sS --fail --location --connect-timeout 20 --max-time 180 \
    -o "${zip}" -w "    http=%{http_code} size=%{size_download}\n" \
    "${url}"
  local zsha
  zsha="$(sha256_file "${zip}")"
  echo "    zip sha256=${zsha}"

  if [[ "${SKIP_UNPACK}" -eq 1 ]]; then
    return 0
  fi

  local extract_dir="${OUT}/${base%.zip}"
  mkdir -p "${extract_dir}"
  unzip -o -q "${zip}" -d "${extract_dir}"
  local ufw
  ufw="$(find "${extract_dir}" -type f \( -iname '*.ufw' -o -iname 'app*' \) | head -n 1 || true)"
  if [[ -n "${ufw}" ]]; then
    echo "    extracted $(basename "${ufw}") ($(wc -c <"${ufw}" | tr -d ' ') bytes) sha256=$(sha256_file "${ufw}")"
  else
    echo "    warning: no .ufw found in zip" >&2
  fi

  # Append / update simple manifest line
  local man="${OUT}/manifest.tsv"
  if [[ ! -f "${man}" ]]; then
    printf 'label\turl\tzip\tzip_sha256\n' >"${man}"
  fi
  printf '%s\t%s\t%s\t%s\n' "${label:-custom}" "${url}" "${base}" "${zsha}" >>"${man}"
}

# Known SuperBand-class packages (see docs/protocol/ota-firmware.md)
URL_DG01='https://cdn.jusonsmart.com/0ta/LJ733/V32399_A12172156_LJ733_V1.2_YJ435_DG01_SUPERBAND.zip'
URL_BJ1='https://cdn.jusonsmart.com/0ta/LJ733/V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preset) PRESET="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --skip-unpack) SKIP_UNPACK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "${PRESET}" && -z "${VERSION}" && -z "${URL}" ]]; then
  usage
  exit 1
fi

mkdir -p "${OUT}"

if [[ -n "${URL}" ]]; then
  download_one "${URL}" "url"
fi

if [[ -n "${PRESET}" ]]; then
  case "${PRESET}" in
    dg01|DG01)
      download_one "${URL_DG01}" "dg01"
      ;;
    bj1|BJ1|bj-1|BJ-1)
      download_one "${URL_BJ1}" "bj1"
      ;;
    all)
      download_one "${URL_DG01}" "dg01"
      download_one "${URL_BJ1}" "bj1"
      ;;
    *)
      echo "Unknown preset: ${PRESET} (use dg01, bj1, all)" >&2
      exit 1
      ;;
  esac
fi

if [[ -n "${VERSION}" ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "bun is required for --version catalog probe" >&2
    exit 1
  fi
  echo "==> probe name=${NAME} version=${VERSION}"
  # Capture OTA_URL= from stderr while showing JSON on stdout
  probe_err="$(mktemp)"
  set +e
  bun "${ROOT}/tools/probe-ota.mjs" --name "${NAME}" --version "${VERSION}" 2>"${probe_err}"
  probe_rc=$?
  set -e
  cat "${probe_err}" >&2
  ota_url="$(grep -E '^OTA_URL=' "${probe_err}" | tail -n1 | cut -d= -f2- || true)"
  rm -f "${probe_err}"
  if [[ -z "${ota_url}" ]]; then
    echo "No firmware offered for name=${NAME} version=${VERSION} (exit ${probe_rc})" >&2
    exit 2
  fi
  download_one "${ota_url}" "catalog-${NAME}-${VERSION}"
fi

echo "Done. Output under ${OUT}"
