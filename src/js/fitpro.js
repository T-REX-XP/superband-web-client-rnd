/**
 * FitPro (non-Baji) dial / watch-theme UART helpers.
 * Used by BJ-1 / LJ733 SuperBand picture push (module 0x1F / 0x20).
 */

import { PROTOCOL, toHex } from './protocol.js';

export const FitPro = {
  DIAL_MODULE: 0x1f,
  DIAL_INFO_MODULE: 0x20,
  /** Legacy MyWatch probes (qm2.D) sent after DeviceFunctionEvent path */
  LEGACY_MODULE: 0x1a,
  /** Picture-push dial id used by SuperBand WatchThemeTransferManager */
  PICTURE_DIAL_ID: 5538,
  DialCmd: {
    DATA: 1,
    START: 2,
    FINISH: 3,
  },
  InfoCmd: {
    STATUS: 1,
    INFO: 2,
  },
  LegacyCmd: {
    /** zl.java post-connect: D(10), D(12), D(28) */
    PROBE_A: 10,
    PROBE_B: 12,
    CAPABILITY: 28,
  },
  /** Status band: 1000 + seq → ACK for chunk seq (0 = start ready) */
  STATUS_CHUNK_BASE: 1000,
  STATUS_OK: 2,
  STATUS_CHECK_FAIL: 1,
  /** Web Bluetooth-safe max image bytes per dial data frame */
  MAX_CHUNK: 180,
  DEFAULT_CHUNK: 180,
};

/** GAP names that speak FitPro dial / crash on Baji media + dial-info probes. */
export function looksLikeFitProBadge(name) {
  if (!name) return false;
  const n = String(name);
  return /^(BJ|DG)/i.test(n) || /BadgeOK|SuperBand|_V\d/i.test(n);
}

function putU16BE(out, offset, value) {
  out[offset] = (value >> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

function putU32BE(out, offset, value) {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function getU16BE(bytes, offset) {
  return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
}

function getU32BE(bytes, offset) {
  return (
    ((bytes[offset] & 0xff) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff)
  ) >>> 0;
}

/** Concatenate Uint8Arrays */
export function concatBytes(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Byte-sum checksum used by WatchTheme3 (unsigned bytes accumulated into int). */
export function fitproByteSum(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] & 0xff;
  return s >>> 0;
}

/**
 * FitPro CD frame: CD | lenBE | module | 01 | cmd | payloadLenBE | payload
 * (same layout as qm2.t / qm2.p in the Android SDK).
 */
export function buildFitProFrame(moduleId, commandId, payload = new Uint8Array(0)) {
  const n = payload.length;
  const total = 8 + n;
  const out = new Uint8Array(total);
  out[0] = PROTOCOL.START;
  putU16BE(out, 1, total - 3);
  out[3] = moduleId & 0xff;
  out[4] = 0x01;
  out[5] = commandId & 0xff;
  putU16BE(out, 6, n);
  if (n) out.set(payload, 8);
  return out;
}

/** Flags bitfield for custom-background-only upload (ks1.a reverse bit pack → 0x08). */
export function dialFlagsCustomBgOnly() {
  return 0x08;
}

/**
 * Dial file blob: u32BE(partLen) + part bytes (custom background only).
 */
export function buildDialFileBlob(imageBytes) {
  const header = new Uint8Array(4);
  putU32BE(header, 0, imageBytes.length);
  return concatBytes(header, imageBytes);
}

/**
 * Start payload for WatchTheme3 custom-background JPEG push.
 * @param {{ dialId?: number, dialType?: number, fileSize: number, flags?: number }} opts
 */
export function buildDialStartPayload({
  dialId = FitPro.PICTURE_DIAL_ID,
  /** 0 = JieLi RGB/BMP path; 2 = JPEG (algorithm 4 only) */
  dialType = 0,
  fileSize,
  flags = dialFlagsCustomBgOnly(),
} = {}) {
  const out = new Uint8Array(4 + 1 + 1 + 3 + 4 + 4);
  let o = 0;
  putU32BE(out, o, dialId);
  o += 4;
  out[o++] = dialType & 0xff;
  out[o++] = flags & 0xff;
  out[o++] = 0; // R
  out[o++] = 0; // G
  out[o++] = 0; // B
  putU32BE(out, o, fileSize);
  o += 4;
  // bgStyle, timeStyle, mixCount=0, bgColor
  out[o++] = 0;
  out[o++] = 0;
  out[o++] = 0;
  out[o++] = 0;
  return out;
}

export function buildDialInfoRequest() {
  return buildFitProFrame(FitPro.DIAL_INFO_MODULE, FitPro.InfoCmd.INFO);
}

export function buildDialStatusRequest() {
  return buildFitProFrame(FitPro.DIAL_INFO_MODULE, FitPro.InfoCmd.STATUS);
}

/** Short legacy probe: CD 00 05 1A 01 {cmd} 00 00 */
export function buildLegacyProbe(cmd) {
  return buildFitProFrame(FitPro.LEGACY_MODULE, cmd);
}

export function buildDialStart(startPayload) {
  return buildFitProFrame(FitPro.DIAL_MODULE, FitPro.DialCmd.START, startPayload);
}

/** seq is 1-based (matches WatchTheme3Tools.O). */
export function buildDialDataChunk(seq, chunk) {
  const head = new Uint8Array(2 + chunk.length);
  putU16BE(head, 0, seq & 0xffff);
  head.set(chunk, 2);
  const sum = fitproByteSum(head);
  const sumBytes = new Uint8Array(4);
  putU32BE(sumBytes, 0, sum);
  return buildFitProFrame(FitPro.DIAL_MODULE, FitPro.DialCmd.DATA, concatBytes(head, sumBytes));
}

export function buildDialFinish(fileBlob) {
  const sumBytes = new Uint8Array(4);
  putU32BE(sumBytes, 0, fitproByteSum(fileBlob));
  return buildFitProFrame(FitPro.DIAL_MODULE, FitPro.DialCmd.FINISH, sumBytes);
}

/**
 * Parse ClockDialInfo payload (bluetooth/c.java C()).
 * @returns {object|null}
 */
export function parseDialInfo(payload) {
  if (!payload || payload.length < 6) return null;
  try {
    const screenType = payload[0] & 0xff;
    const grade = payload[1] & 0xff;
    const width = getU16BE(payload, 2);
    const height = getU16BE(payload, 4);
    let o = 6;
    const mchLen = payload[o++] & 0xff;
    if (o + mchLen > payload.length) return null;
    const mchModel = new TextDecoder().decode(payload.slice(o, o + mchLen));
    o += mchLen;
    const mainLen = payload[o++] & 0xff;
    if (o + mainLen > payload.length) return null;
    const mainModel = new TextDecoder().decode(payload.slice(o, o + mainLen));
    o += mainLen;
    let config = 0;
    let algorithm = 0;
    if (o < payload.length) config = payload[o] & 0xff;
    if (o + 1 < payload.length) algorithm = payload[o + 1] & 0xff;
    // versionCode / customer / pictureNums / themeVersion / shortPkg — best-effort
    let shortPkg = 0;
    let themeVersion = 0;
    let pictureNums = 0;
    const i6 = o;
    const i12 = i6 + 5;
    let customerLen = 0;
    if (payload.length > i12) {
      customerLen = payload[i12] & 0xff;
    }
    const i13 = i12 + customerLen;
    if (payload.length > i13 + 1) pictureNums = payload[i13 + 1] & 0xff;
    if (payload.length >= i13 + 4) themeVersion = getU16BE(payload, i13 + 2);
    if (payload.length >= i13 + 6) shortPkg = getU16BE(payload, i13 + 4);

    return {
      screenType,
      grade,
      width,
      height,
      mchModel,
      mainModel,
      config,
      algorithm,
      pictureNums,
      themeVersion,
      shortPkgLength: shortPkg,
      dialType: algorithm === 4 ? 2 : 0,
      jpeg: algorithm === 4,
    };
  } catch {
    return null;
  }
}

export function parseDialStatusCode(payload) {
  if (!payload || payload.length < 4) return null;
  return getU32BE(payload, 0);
}

/** Maps device dial-status codes to Android WatchThemeTransferManager meanings. */
export function dialUpgradeStatusMessage(code) {
  const messages = {
    1: 'verification failed',
    2: 'upgrade success',
    3: 'battery too low',
    4: 'device is charging — unplug power and retry',
    5: 'insufficient storage space',
    6: 'theme count limit exceeded',
    7: 'duplicate upgrade',
    8: 'theme id not found',
    9: 'upgrade too frequent — wait and retry',
  };
  return messages[code] || `unknown status ${code}`;
}

export function formatDialUpgradeError(code) {
  return `Dial upgrade error status=${code} (${dialUpgradeStatusMessage(code)})`;
}

export function isFitProDialInfoPacket(pkt) {
  return (
    pkt &&
    (pkt.dialect === 'fitpro' || pkt.legacy) &&
    (pkt.moduleId === FitPro.DIAL_INFO_MODULE || pkt.moduleKey === FitPro.DIAL_INFO_MODULE) &&
    (pkt.commandId === FitPro.InfoCmd.INFO || pkt.command === FitPro.InfoCmd.INFO)
  );
}

export function isFitProDialStatusPacket(pkt) {
  return (
    pkt &&
    (pkt.dialect === 'fitpro' || pkt.legacy) &&
    (pkt.moduleId === FitPro.DIAL_INFO_MODULE || pkt.moduleKey === FitPro.DIAL_INFO_MODULE) &&
    (pkt.commandId === FitPro.InfoCmd.STATUS || pkt.command === FitPro.InfoCmd.STATUS)
  );
}

export function describeFitProDial(info) {
  if (!info) return '';
  return [
    `${info.width}×${info.height}`,
    `alg=${info.algorithm}`,
    info.shortPkgLength ? `chunk=${info.shortPkgLength}` : null,
    info.mchModel || info.mainModel || null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function dialChunkSize(info) {
  const fromDev = info?.shortPkgLength > 0 ? info.shortPkgLength : FitPro.DEFAULT_CHUNK;
  return Math.min(fromDev, FitPro.MAX_CHUNK);
}

/** Debug helper */
export function fitproFrameHex(bytes) {
  return toHex(bytes);
}
