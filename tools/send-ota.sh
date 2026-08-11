#!/usr/bin/env bash
# Prepare and/or send a SuperBand / LJ733 JieLi OTA package (zip → app.ufw → BLE AE00).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/research/firmware"
PRESET=""
VERSION=""
NAME="BJ-1"
URL=""
ZIP=""
UFW=""
ADDRESS=""
ACTION="prepare" # prepare | scan | probe | flash | usb-hint
TIMEOUT=8
PROBE_FIRST=0
YES=0
VENV="${ROOT}/tools/.venv-ota"

BJ1_URL="https://cdn.jusonsmart.com/0ta/LJ733/V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip"
DG01_URL="https://cdn.jusonsmart.com/0ta/LJ733/V32399_A12172156_LJ733_V1.2_YJ435_DG01_SUPERBAND.zip"

usage() {
  cat <<'EOF'
Usage: ./tools/send-ota.sh [options]

Resolve a JieLi OTA package (zip/ufw), then prepare and optionally flash over BLE.

Package source (pick one):
  --preset bj1|dg01     Known SuperBand CDN zip
  --zip PATH            Local OTA zip
  --ufw PATH            Local app.ufw (skip unzip)
  --version Vxxxxx      Probe tomato catalog + download if offered
  --name NAME           Catalog/GAP name with --version (default: BJ-1)
  --url URL             Download a specific zip URL

Actions:
  --prepare             Download/extract only (default)
  --scan                BLE scan for badges (needs bleak)
  --probe               Connect + check AE00/UART (--address required)
  --ble / --flash       Flash UFW via openwearota (--address required)
  --usb-hint            Print USB/UART forced-update notes (chipkey B165)
  --probe-first         With --ble: probe AE00 before flashing
  --address MAC         Target BLE address (AA:BB:CC:DD:EE:FF)
  --timeout SEC         Scan timeout (default: 8)
  --out DIR             Working dir (default: research/firmware)
  --venv PATH           Python venv for bleak/openwearota (default: tools/.venv-ota)
  --yes                 Skip interactive confirm on --ble
  -h, --help            Show help

Examples:
  ./tools/send-ota.sh --preset bj1 --prepare
  ./tools/send-ota.sh --scan
  ./tools/send-ota.sh --preset bj1 --probe --address AA:BB:CC:DD:EE:FF
  ./tools/send-ota.sh --preset bj1 --ble --address AA:BB:CC:DD:EE:FF
  ./tools/send-ota.sh --ufw research/firmware/bj1_extract/app.ufw --ble --address …

Risks: see docs/protocol/security.md (public CDN, cross-SKU brick risk, USB bypass).
EOF
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

ensure_venv() {
  if [[ -x "${VENV}/bin/python" ]]; then
    return 0
  fi
  echo "==> Creating OTA venv at ${VENV}"
  python3 -m venv "${VENV}"
  "${VENV}/bin/pip" install -U pip
  "${VENV}/bin/pip" install 'bleak>=0.22' 'openwearota>=0.0.1a2'
}

py() {
  if [[ -x "${VENV}/bin/python" ]]; then
    echo "${VENV}/bin/python"
  else
    echo "python3"
  fi
}

download_zip() {
  local url="$1"
  local label="${2:-ota}"
  mkdir -p "${OUT}"
  local base
  base="$(basename "${url%%\?*}")"
  base="$(printf '%b' "${base//%/\\x}")"
  ZIP="${OUT}/${base}"
  if [[ -f "${ZIP}" ]]; then
    echo "==> Reusing ${ZIP}"
  else
    echo "==> Download ${label}"
    echo "    ${url}"
    curl -sS --fail --location --connect-timeout 20 --max-time 180 \
      -o "${ZIP}" -w "    http=%{http_code} size=%{size_download}\n" "${url}"
  fi
  echo "    zip sha256=$(sha256_file "${ZIP}")"
}

extract_ufw() {
  local zip="$1"
  local extract_dir="${OUT}/$(basename "${zip}" .zip)_ota"
  mkdir -p "${extract_dir}"
  echo "==> Extract ${zip}"
  unzip -o -q "${zip}" -d "${extract_dir}"
  UFW="$(find "${extract_dir}" -type f \( -iname '*.ufw' -o -iname 'app.ufw' \) | head -n 1 || true)"
  if [[ -z "${UFW}" ]]; then
    UFW="$(find "${extract_dir}" -type f -iname 'app*' | head -n 1 || true)"
  fi
  if [[ -z "${UFW}" ]]; then
    echo "error: no .ufw in zip" >&2
    exit 1
  fi
  echo "    ufw=${UFW}"
  echo "    size=$(wc -c <"${UFW}" | tr -d ' ') sha256=$(sha256_file "${UFW}")"
}

resolve_package() {
  if [[ -n "${UFW}" ]]; then
    UFW="$(cd "$(dirname "${UFW}")" && pwd)/$(basename "${UFW}")"
    [[ -f "${UFW}" ]] || { echo "error: ufw not found: ${UFW}" >&2; exit 1; }
    echo "==> Using UFW ${UFW}"
    echo "    sha256=$(sha256_file "${UFW}")"
    return 0
  fi

  if [[ -n "${ZIP}" ]]; then
    ZIP="$(cd "$(dirname "${ZIP}")" && pwd)/$(basename "${ZIP}")"
    [[ -f "${ZIP}" ]] || { echo "error: zip not found: ${ZIP}" >&2; exit 1; }
    extract_ufw "${ZIP}"
    return 0
  fi

  if [[ -n "${URL}" ]]; then
    download_zip "${URL}" "url"
    extract_ufw "${ZIP}"
    return 0
  fi

  if [[ -n "${VERSION}" ]]; then
    echo "==> Probe catalog name=${NAME} version=${VERSION}"
    local url_line
    set +e
    url_line="$(cd "${ROOT}" && bun tools/probe-ota.mjs --name "${NAME}" --version "${VERSION}" --quiet 2>&1 | grep -E '^OTA_URL=' | head -n1)"
    local st=$?
    set -e
    if [[ "${st}" -ne 0 || -z "${url_line}" ]]; then
      # retry without quiet for human error
      bun "${ROOT}/tools/probe-ota.mjs" --name "${NAME}" --version "${VERSION}" || true
      echo "error: catalog offered no download URL" >&2
      exit 2
    fi
    URL="${url_line#OTA_URL=}"
    download_zip "${URL}" "catalog-${VERSION}"
    extract_ufw "${ZIP}"
    return 0
  fi

  case "${PRESET}" in
    bj1)
      # Prefer already-downloaded BJ-1 zip if present
      local existing
      existing="$(ls -1 "${OUT}"/V32286_*BJ-1*.zip 2>/dev/null | head -n1 || true)"
      if [[ -n "${existing}" ]]; then
        ZIP="${existing}"
        echo "==> Preset bj1 → ${ZIP}"
        extract_ufw "${ZIP}"
      elif [[ -f "${OUT}/bj1_extract/app.ufw" ]]; then
        UFW="${OUT}/bj1_extract/app.ufw"
        echo "==> Preset bj1 → cached ${UFW}"
      else
        download_zip "${BJ1_URL}" "preset-bj1"
        extract_ufw "${ZIP}"
      fi
      ;;
    dg01)
      existing="$(ls -1 "${OUT}"/*DG01*.zip 2>/dev/null | head -n1 || true)"
      if [[ -n "${existing}" ]]; then
        ZIP="${existing}"
        extract_ufw "${ZIP}"
      elif [[ -f "${OUT}/lj733_dg01_extract/app.ufw" ]]; then
        UFW="${OUT}/lj733_dg01_extract/app.ufw"
        echo "==> Preset dg01 → cached ${UFW}"
      else
        download_zip "${DG01_URL}" "preset-dg01"
        extract_ufw "${ZIP}"
      fi
      ;;
    "")
      if [[ "${ACTION}" == "scan" || "${ACTION}" == "usb-hint" ]]; then
        return 0
      fi
      echo "error: provide --preset / --zip / --ufw / --version / --url" >&2
      usage
      exit 1
      ;;
    *)
      echo "error: unknown preset ${PRESET}" >&2
      exit 1
      ;;
  esac
}

print_summary() {
  cat <<EOF

=== OTA package ready ===
ufw:     ${UFW:-'(none)'}
zip:     ${ZIP:-'(none)'}
chipkey: \$B165 (from LJ733 SuperBand UFW analysis)
SoC:     AC707N (JieLi AE00 RCSP OTA)
docs:    docs/protocol/ota-firmware.md
risks:   docs/protocol/security.md

Next:
  ./tools/send-ota.sh --scan
  ./tools/send-ota.sh --ufw ${UFW:-PATH} --probe --address AA:BB:CC:DD:EE:FF
  ./tools/send-ota.sh --ufw ${UFW:-PATH} --ble --address AA:BB:CC:DD:EE:FF
  ./tools/send-ota.sh --usb-hint
EOF
}

usb_hint() {
  cat <<'EOF'
=== USB / UART forced update (JieLi) ===

Shipping SuperBand UFW packages expose chipkey $B165 and uboot strings
UARTUPDATE / UART_UPDATE_CUSTOM plus Zusb_hid_ota / Zuart_update loaders.

Typical factory path (vendor tools, not shipped here):
  1. JieLi USB updater / download tool (Windows) + chipkey $B165
  2. Hold device in download mode (reset / power timing per AC707N board)
  3. Flash the matching SuperBand app.ufw / update image ONLY
     (BJ-1 vs DG01 — do not cross-flash LJ755/LJ760/LJ733B)

This bypasses BLE RCSP auth (see security.md F4). Prefer BLE OTA when possible.
EOF
}

# --- args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preset) PRESET="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --zip) ZIP="$2"; shift 2 ;;
    --ufw) UFW="$2"; shift 2 ;;
    --address) ADDRESS="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --venv) VENV="$2"; shift 2 ;;
    --prepare) ACTION="prepare"; shift ;;
    --scan) ACTION="scan"; shift ;;
    --probe) ACTION="probe"; shift ;;
    --ble|--flash) ACTION="flash"; shift ;;
    --usb-hint) ACTION="usb-hint"; shift ;;
    --probe-first) PROBE_FIRST=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

case "${ACTION}" in
  usb-hint)
    usb_hint
    exit 0
    ;;
  scan)
    ensure_venv
    exec "$(py)" "${ROOT}/tools/send-ota-ble.py" scan --timeout "${TIMEOUT}"
    ;;
  probe)
    [[ -n "${ADDRESS}" ]] || { echo "error: --address required" >&2; exit 1; }
    ensure_venv
    exec "$(py)" "${ROOT}/tools/send-ota-ble.py" probe --address "${ADDRESS}"
    ;;
  prepare)
    resolve_package
    print_summary
    ;;
  flash)
    [[ -n "${ADDRESS}" ]] || { echo "error: --address required for --ble" >&2; exit 1; }
    resolve_package
    [[ -n "${UFW}" ]] || { echo "error: no ufw resolved" >&2; exit 1; }
    echo
    echo "About to BLE-OTA flash:"
    echo "  address: ${ADDRESS}"
    echo "  ufw:     ${UFW}"
    echo "  sha256:  $(sha256_file "${UFW}")"
    if [[ "${YES}" -ne 1 ]]; then
      read -r -p "Type YES to continue: " ans
      [[ "${ans}" == "YES" ]] || { echo "aborted"; exit 1; }
    fi
    ensure_venv
    # Ensure openwearota on PATH for the helper
    export PATH="${VENV}/bin:${PATH}"
    args=(flash --address "${ADDRESS}" --ufw "${UFW}")
    if [[ "${PROBE_FIRST}" -eq 1 ]]; then
      args+=(--probe-first)
    fi
    exec "$(py)" "${ROOT}/tools/send-ota-ble.py" "${args[@]}"
    ;;
  *)
    echo "error: unknown action ${ACTION}" >&2
    exit 1
    ;;
esac
