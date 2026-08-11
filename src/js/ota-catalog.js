/**
 * OTA package resolve helpers (mirrors tools/send-ota.sh presets + catalog).
 */

import { unzipSync } from 'fflate';

export const OTA_TOKEN = 'Bearer 6fcb7f58475b4e5aad8f0f1cadce235e';
export const OTA_PKG = 'com.legend.smartwatch.electronicbadge.android';

export const OTA_PRESETS = {
  bj1: {
    id: 'bj1',
    label: 'BJ-1 SuperBand (V32286)',
    catalogVersion: 'V32172',
    name: 'BJ-1',
    url: 'https://cdn.jusonsmart.com/0ta/LJ733/V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip',
    chipkey: '$B165',
  },
  dg01: {
    id: 'dg01',
    label: 'DG01 SuperBand (V32399)',
    catalogVersion: 'V32294',
    name: 'DG01',
    url: 'https://cdn.jusonsmart.com/0ta/LJ733/V32399_A12172156_LJ733_V1.2_YJ435_DG01_SUPERBAND.zip',
    chipkey: '$B165',
  },
};

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Probe tomato catalog (may fail in browser if CORS blocks — CDN presets still work).
 */
export async function probeOtaCatalog({ name = 'BJ-1', version }) {
  if (!version) throw new Error('version required');
  const url = new URL('https://tomato.gulaike.com/api/v1/config/app');
  url.searchParams.set('name', name);
  url.searchParams.set('type', '1');
  url.searchParams.set('version', version);
  const appName = btoa(OTA_PKG);
  const res = await fetch(url, {
    headers: {
      authorization: OTA_TOKEN,
      'app-type': '1',
      'app-name': appName,
      'app-version': '2.1.25',
      country: 'foreign',
    },
  });
  const body = await res.json();
  return {
    ok: res.ok,
    status: res.status,
    url: url.toString(),
    body,
    downloadUrl: body?.data?.app_down_url || null,
    force: body?.data?.force,
    catalogName: body?.data?.name,
    catalogVersion: body?.data?.version,
  };
}

export async function downloadZip(url, { onProgress } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(100);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(99, Math.round((received / total) * 100)));
  }
  const out = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  onProgress?.(100);
  return out;
}

/** Find app.ufw (or first *.ufw) inside a zip buffer. */
export function extractUfwFromZip(zipBytes) {
  const files = unzipSync(zipBytes);
  const names = Object.keys(files);
  const prefer =
    names.find((n) => /app\.ufw$/i.test(n)) ||
    names.find((n) => /\.ufw$/i.test(n)) ||
    names.find((n) => /\/app[^/]*$/i.test(n) && !n.endsWith('/'));
  if (!prefer) {
    throw new Error(`No .ufw in zip (files: ${names.slice(0, 8).join(', ')})`);
  }
  return { name: prefer.split('/').pop(), path: prefer, bytes: files[prefer] };
}

export async function loadOtaPackageFromFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.ufw') || lower.endsWith('.bin')) {
    return {
      source: 'file',
      fileName: file.name,
      ufwName: file.name,
      ufwBytes: buf,
      zipBytes: null,
      sha256: await sha256Hex(buf),
    };
  }
  if (lower.endsWith('.zip')) {
    const { name, bytes } = extractUfwFromZip(buf);
    return {
      source: 'file-zip',
      fileName: file.name,
      ufwName: name,
      ufwBytes: bytes,
      zipBytes: buf,
      sha256: await sha256Hex(bytes),
    };
  }
  throw new Error('Choose a .ufw or OTA .zip');
}

export async function loadOtaPackageFromPreset(presetId, { onProgress } = {}) {
  const preset = OTA_PRESETS[presetId];
  if (!preset) throw new Error(`Unknown preset ${presetId}`);
  const zipBytes = await downloadZip(preset.url, { onProgress });
  const { name, bytes } = extractUfwFromZip(zipBytes);
  return {
    source: 'preset',
    preset: preset.id,
    label: preset.label,
    fileName: preset.url.split('/').pop(),
    ufwName: name,
    ufwBytes: bytes,
    zipBytes,
    sha256: await sha256Hex(bytes),
    chipkey: preset.chipkey,
    url: preset.url,
  };
}

export const USB_HINT = `USB / UART forced update (JieLi)

Shipping SuperBand UFW packages expose chipkey $B165 and uboot strings
UARTUPDATE / UART_UPDATE_CUSTOM plus Zusb_hid_ota / Zuart_update loaders.

Typical factory path (vendor Windows tools):
  1. JieLi USB updater + chipkey $B165
  2. Enter download mode (reset / power timing per AC707N board)
  3. Flash the matching SuperBand app.ufw ONLY (BJ-1 vs DG01)

This bypasses BLE RCSP auth. Prefer BLE OTA when possible.
See docs/protocol/security.md (F4).`;

export const SECURITY_FINDINGS = [
  { id: 'F1', sev: 'critical', title: 'Hardcoded OTA catalog bearer token in APK' },
  { id: 'F2', sev: 'critical', title: 'Firmware CDN public (no auth, CORS *)' },
  { id: 'F3', sev: 'high', title: 'UART plane has no cryptographic auth' },
  { id: 'F4', sev: 'high', title: 'USB/UART forced update + chipkey $B165' },
  { id: 'F5', sev: 'medium', title: 'Cross-SKU catalog collision (version-keyed)' },
  { id: 'F6', sev: 'medium', title: 'Debug/test symbols left in app.bin' },
  { id: 'F7', sev: 'medium', title: 'Server force-upgrade flag' },
  { id: 'F8', sev: 'low', title: 'Watch-SDK leftovers (not a hidden C2)' },
];
