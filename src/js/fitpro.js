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
  /**
   * Android WatchTheme3Tools `gh3.t()` default when shortPkg unknown.
   * On Web Bluetooth we must also fit one complete FitPro DATA frame in a single
   * GATT write — splitting a CD frame across writes made BJ-1 ACK then show black.
   */
  ANDROID_DEFAULT_CHUNK: 5000,
  /** CD(1)+len(2)+mod/cmd(3)+plen(2) + seq(2) + sum(4) */
  DATA_FRAME_OVERHEAD: 14,
  /** Android CommandPool.n(6) during dial upgrade */
  COMMAND_POOL_MS: 6,
  /** gh3 countdown: 15s total, 5s ticks; status poll when remaining ≤ 10s */
  ACK_TIMEOUT_MS: 15000,
  ACK_TICK_MS: 5000,
};

/** GAP names that speak FitPro dial / crash on Baji media + dial-info probes. */
export function looksLikeFitProBadge(name) {
  if (!name) return false;
  const n = String(name);
  return /^(BJ|DG|BG)/i.test(n) || /BadgeOK|SuperBand|_V\d/i.test(n);
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
 * Start payload for WatchTheme3 custom-background push.
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

/** Free-space query: module `0x20` / key `4` (SDK `getDialWatchRemainSpace`). */
export function buildDialRemainSpaceRequest() {
  return buildFitProFrame(FitPro.DIAL_INFO_MODULE, 4);
}

/**
 * Dial free-space response payload. SDK parses it as a long (`bytesToLong`),
 * so expect 8 bytes big-endian; fall back to u32BE on short payloads.
 * @param {Uint8Array} payload
 * @returns {number|null}
 */
export function parseDialRemainSpace(payload) {
  if (!payload || !payload.length) return null;
  if (payload.length >= 8) {
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(payload[i] & 0xff);
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (payload.length >= 4) return getU32BE(payload, 0);
  return null;
}

/** Short legacy probe: CD 00 05 1A 01 {cmd} 00 00 */
export function buildLegacyProbe(cmd) {
  return buildFitProFrame(FitPro.LEGACY_MODULE, cmd);
}

/**
 * Legacy `0x1A` key 10 response payload = the badge's own 6-byte BD_ADDR.
 * This is the *identity* address shown on the badge screen (and its QR code);
 * the OS/Web Bluetooth may expose a different random (resolvable) advertising
 * address for the same device.
 * @param {Uint8Array} payload
 * @returns {string|null} e.g. "AA:BB:CC:DD:EE:FF"
 */
export function parseLegacyMac(payload) {
  if (payload?.length !== 6) return null;
  return [...payload.slice(0, 6)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
}

/**
 * Legacy `0x1A` key 12 response payload = `u8 len ‖ ASCII name` (e.g. "BG02").
 * @param {Uint8Array} payload
 * @returns {string|null}
 */
export function parseLegacyName(payload) {
  if (!payload || payload.length < 2) return null;
  const len = payload[0];
  if (len !== payload.length - 1) return null;
  const end = payload.length;
  let s = '';
  for (let i = 1; i < end; i++) {
    const c = payload[i];
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s || null;
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
  if (!payload || payload.length < 10) return null;
  try {
    const screenType = payload[0] & 0xff;
    const grade = payload[1] & 0xff;
    const width = getU16BE(payload, 2);
    const height = getU16BE(payload, 4);
    if (!width || !height) return null;
    let o = 6;
    const mchLen = payload[o++] & 0xff;
    if (o + mchLen >= payload.length) return null;
    const mchModel = new TextDecoder().decode(payload.slice(o, o + mchLen));
    o += mchLen;
    const mainLen = payload[o++] & 0xff;
    if (o + mainLen + 2 > payload.length) return null;
    const mainModel = new TextDecoder().decode(payload.slice(o, o + mainLen));
    o += mainLen;
    const config = payload[o];
    const algorithm = payload[o + 1];
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

/**
 * Interpret a raw dial-status code the way SDK `WatchTheme3Tools.response()` does.
 * Bands: `{1000,1e8}` chunk ACKs, `{1e8,2e8}` storage (`<1><0><freeBytes>`),
 * then small codes `2`=success / `1..9`=errors.
 * @returns {{kind:'ack',seq:number}|{kind:'success'}|{kind:'error',code:number}|{kind:'memory',freeBytes:number|null}|{kind:'other',code:number}}
 */
export function decodeDialStatus(code) {
  if (code == null) return { kind: 'other', code: null };
  if (code >= 1000 && code < 100000000) return { kind: 'ack', seq: code - 1000 };
  if (code >= 100000000 && code < 200000000) {
    const s = String(code);
    // dy "1 0 <freeBytes>" → memory-less; else a different 1e8-band message.
    if (s[1] === '0') return { kind: 'memory', freeBytes: Number(s.slice(2)) };
    return { kind: 'other', code };
  }
  if (code === 2) return { kind: 'success' };
  if (code >= 1 && code <= 9) return { kind: 'error', code };
  return { kind: 'other', code };
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

/**
 * Dial DATA payload size.
 * Prefer device shortPkg / Android 5000, but never exceed what fits in one GATT write
 * (`maxWriteLength - DATA_FRAME_OVERHEAD`). Default maxWriteLength 512 → 498 B.
 */
export function dialChunkSize(info, maxWriteLength = 512) {
  const fromDev =
    info?.shortPkgLength > 0 ? Number(info.shortPkgLength) : FitPro.ANDROID_DEFAULT_CHUNK;
  const attCap = (Number(maxWriteLength) || 512) - FitPro.DATA_FRAME_OVERHEAD;
  if (attCap < 1) throw new RangeError('GATT write limit is too small for dial data');
  const want = Number.isFinite(fromDev) && fromDev >= 1 ? fromDev : FitPro.ANDROID_DEFAULT_CHUNK;
  return Math.min(want, attCap);
}

/** Debug helper */
export function fitproFrameHex(bytes) {
  return toHex(bytes);
}
