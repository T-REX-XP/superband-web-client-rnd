/**
 * SuperBand / Baji BLE protocol codec
 * From RnD investigation of SuperBand 2.1.25
 */

export const GATT = {
  SERVICE: '7e400001-b5a3-f393-e0a9-e50e24dcca9d',
  WRITE: '7e400002-b5a3-f393-e0a9-e50e24dcca9d',
  NOTIFY: '7e400003-b5a3-f393-e0a9-e50e24dcca9d',
  LOG: '7e400004-b5a3-f393-e0a9-e50e24dcca9d',
  BATTERY_SERVICE: '0000180f-0000-1000-8000-00805f9b34fb',
  BATTERY_LEVEL: '00002a19-0000-1000-8000-00805f9b34fb',
  DIS_SERVICE: '0000180a-0000-1000-8000-00805f9b34fb',
  DIS_MODEL: '00002a24-0000-1000-8000-00805f9b34fb',
  DIS_SERIAL: '00002a25-0000-1000-8000-00805f9b34fb',
  DIS_FIRMWARE: '00002a26-0000-1000-8000-00805f9b34fb',
  DIS_HARDWARE: '00002a27-0000-1000-8000-00805f9b34fb',
  DIS_SOFTWARE: '00002a28-0000-1000-8000-00805f9b34fb',
  DIS_MANUFACTURER: '00002a29-0000-1000-8000-00805f9b34fb',
};

/** Official project repository (shown in the manager UI). */
export const REPO_URL = 'https://github.com/T-REX-XP/superband-web-client-rnd';

export const PROTOCOL = {
  START: 0xcd,
  PRODUCT_ID: 0x25,
  VERSION: 0x01,
  MAX_CHUNK: 200,
  MAX_PACKET: 512,
  COMPANY_ID: 0xaa01,
  DEVICE_TYPE_BADGE: 3,
};

export const Module = {
  FILE_TRANSFER: 0x01,
  MEDIA: 0x02,
  SYSTEM: 0x03,
};

export const SysCmd = {
  DEVICE_INFO_REQUEST: 0x00,
  DEVICE_INFO_RESPONSE: 0x01,
};

export const FileCmd = {
  TRANSFER_START: 0x00,
  TRANSFER_STOP: 0x01,
  TRANSFER_ACK: 0x02,
  TRANSFER_NACK: 0x03,
  NEXT_CHUNK: 0x04,
  RETRY: 0x05,
  TRANSFER_COMPLETE: 0x06,
  FILE_DATA: 0x0a,
  STATUS: 0x0b,
  RECEIVED_CHECKSUM: 0x0c,
  TOTAL_TRANSFERRED: 0x0d,
  VERIFICATION_RESULT: 0x0e,
};

export const MediaCmd = {
  LIST_REQUEST: 0x00,
  LIST_RESPONSE: 0x01,
  DELETE: 0x02,
  INFO_REQUEST: 0x03,
  INFO_RESPONSE: 0x04,
  PREVIEW_REQUEST: 0x05,
  PREVIEW_RESPONSE: 0x06,
  PREVIEW_PUSH_REQUEST: 0x07,
  PREVIEW_PUSH_RESPONSE: 0x08,
  BACKGROUND_REQUEST: 0x09,
  BACKGROUND_RESPONSE: 0x0a,
  BACKGROUND_PUSH_REQUEST: 0x0b,
  BACKGROUND_PUSH_RESPONSE: 0x0c,
  ID_REQUEST: 0x0d,
  ID_RESPONSE: 0x0e,
  BATCH_PREVIEW_INFO_REQUEST: 0x0f,
  BATCH_PREVIEW_INFO_RESPONSE: 0x10,
  BATCH_PREVIEW_DATA_REQUEST: 0x11,
  BATCH_PREVIEW_DATA_RESPONSE: 0x12,
};

export const FileType = { IMAGE: 1, VIDEO: 2, ANIMATION: 3, MULTI_FILE: 0xff };
export const FunctionType = { BACKGROUND: 1, STICKER: 2, FONT: 3, PREVIEW: 4 };

export const ErrorCode = {
  0: 'SUCCESS',
  1: 'INVALID_PACKET',
  2: 'UNSUPPORTED_COMMAND',
  3: 'INVALID_PARAMETER',
  4: 'FILE_NOT_FOUND',
  5: 'FILE_TOO_LARGE',
  6: 'INSUFFICIENT_STORAGE',
  7: 'TRANSFER_TIMEOUT',
  8: 'CHECKSUM_MISMATCH',
  9: 'DEVICE_BUSY',
  10: 'FILE_SIZE_MISMATCH',
  11: 'VERIFICATION_FAILED',
  12: 'INVALID_PAYLOAD',
  255: 'UNKNOWN_ERROR',
};

const MODULE_NAMES = {
  [Module.FILE_TRANSFER]: 'FILE_TRANSFER',
  [Module.MEDIA]: 'MEDIA',
  [Module.SYSTEM]: 'SYSTEM',
};

const CMD_NAMES = {
  [Module.SYSTEM]: {
    [SysCmd.DEVICE_INFO_REQUEST]: 'DEVICE_INFO_REQUEST',
    [SysCmd.DEVICE_INFO_RESPONSE]: 'DEVICE_INFO_RESPONSE',
  },
  [Module.FILE_TRANSFER]: Object.fromEntries(
    Object.entries(FileCmd).map(([k, v]) => [v, k]),
  ),
  [Module.MEDIA]: Object.fromEntries(
    Object.entries(MediaCmd).map(([k, v]) => [v, k]),
  ),
};

export function toHex(bytes, sep = ' ') {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(sep);
}

export function fromHex(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2) throw new Error('Odd hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function putU16BE(view, offset, value) {
  view.setUint16(offset, value & 0xffff, false);
}

function putU32BE(view, offset, value) {
  view.setUint32(offset, value >>> 0, false);
}

function putU64BE(view, offset, value) {
  const big = BigInt(value);
  view.setUint32(offset, Number((big >> 32n) & 0xffffffffn), false);
  view.setUint32(offset + 4, Number(big & 0xffffffffn), false);
}

function getU16BE(view, offset) {
  return view.getUint16(offset, false);
}

function getU32BE(view, offset) {
  return view.getUint32(offset, false);
}

function getU64BE(view, offset) {
  const hi = BigInt(view.getUint32(offset, false));
  const lo = BigInt(view.getUint32(offset + 4, false));
  return hi << 32n | lo;
}

/** Legacy pairing frame: CD 00 06 12 01 0A 00 01 02 */
export function buildPairingFrame() {
  return new Uint8Array([0xcd, 0x00, 0x06, 0x12, 0x01, 0x0a, 0x00, 0x01, 0x02]);
}

/**
 * Build a Baji packet.
 * @param {number} moduleId
 * @param {number} commandId
 * @param {Uint8Array} [payload]
 */
export function buildPacket(moduleId, commandId, payload = new Uint8Array(0)) {
  const n = payload.length;
  const total = 9 + n;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out[0] = PROTOCOL.START;
  putU16BE(view, 1, n + 6);
  out[3] = PROTOCOL.PRODUCT_ID;
  out[4] = PROTOCOL.VERSION;
  out[5] = moduleId & 0xff;
  putU16BE(view, 6, n + 1);
  out[8] = commandId & 0xff;
  out.set(payload, 9);
  return out;
}

/**
 * Parse one complete Baji packet from a buffer.
 * Returns null if incomplete / not Baji.
 */
export function parsePacket(bytes) {
  if (bytes.length < 9) return null;
  if (bytes[0] !== PROTOCOL.START) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataLength = getU16BE(view, 1);
  const total = 3 + dataLength;
  if (bytes.length < total) return { incomplete: true, need: total };
  if (bytes[3] !== PROTOCOL.PRODUCT_ID) {
    return {
      legacy: true,
      raw: bytes.slice(0, total),
      moduleKey: bytes[3],
      version: bytes[4],
      command: bytes[5],
    };
  }
  const moduleId = bytes[5];
  const bodyLen = getU16BE(view, 6);
  const commandId = bytes[8];
  const payloadLen = Math.max(0, bodyLen - 1);
  const payload = bytes.slice(9, 9 + payloadLen);
  return {
    raw: bytes.slice(0, total),
    productId: bytes[3],
    version: bytes[4],
    moduleId,
    commandId,
    payload,
    moduleName: MODULE_NAMES[moduleId] || `MOD_0x${moduleId.toString(16)}`,
    commandName: CMD_NAMES[moduleId]?.[commandId] || `CMD_0x${commandId.toString(16)}`,
  };
}

/** Reassemble notify stream into packets */
export class PacketAssembler {
  constructor() {
    this.buf = new Uint8Array(0);
  }

  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const packets = [];
    while (this.buf.length >= 3) {
      if (this.buf[0] !== PROTOCOL.START) {
        const idx = this.buf.indexOf(PROTOCOL.START);
        if (idx < 0) {
          this.buf = new Uint8Array(0);
          break;
        }
        this.buf = this.buf.slice(idx);
        continue;
      }
      if (this.buf.length < 3) break;
      const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const total = 3 + getU16BE(view, 1);
      if (this.buf.length < total) break;
      const frame = this.buf.slice(0, total);
      this.buf = this.buf.slice(total);
      packets.push(parsePacket(frame));
    }
    return packets;
  }

  reset() {
    this.buf = new Uint8Array(0);
  }
}

export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function buildDeviceInfoRequest() {
  return buildPacket(Module.SYSTEM, SysCmd.DEVICE_INFO_REQUEST);
}

export function buildMediaIdRequest() {
  return buildPacket(Module.MEDIA, MediaCmd.ID_REQUEST);
}

export function buildMediaListRequest() {
  return buildPacket(Module.MEDIA, MediaCmd.LIST_REQUEST);
}

export function buildMediaDelete(mediaId) {
  const p = new Uint8Array(8);
  putU64BE(new DataView(p.buffer), 0, mediaId);
  return buildPacket(Module.MEDIA, MediaCmd.DELETE, p);
}

export function buildTransferStart({ fileSize, fileType, functionType, mediaId }) {
  const p = new Uint8Array(14);
  const view = new DataView(p.buffer);
  p[0] = 0x07;
  putU32BE(view, 1, fileSize);
  p[5] = 0x08;
  p[6] = fileType & 0xff;
  p[7] = 0x0a;
  p[8] = functionType & 0xff;
  p[9] = 0x09;
  putU32BE(view, 10, mediaId >>> 0);
  return buildPacket(Module.FILE_TRANSFER, FileCmd.TRANSFER_START, p);
}

export function buildFileData({ fileId, chunkIndex, data, isLast }) {
  const p = new Uint8Array(17 + data.length);
  const view = new DataView(p.buffer);
  putU64BE(view, 0, fileId);
  putU32BE(view, 8, chunkIndex);
  putU32BE(view, 12, data.length);
  p[16] = isLast ? 1 : 0;
  p.set(data, 17);
  return buildPacket(Module.FILE_TRANSFER, FileCmd.FILE_DATA, p);
}

export function buildTransferComplete(fileId, checksum) {
  const p = new Uint8Array(12);
  const view = new DataView(p.buffer);
  putU64BE(view, 0, fileId);
  putU32BE(view, 8, checksum);
  return buildPacket(Module.FILE_TRANSFER, FileCmd.TRANSFER_COMPLETE, p);
}

export function buildVerificationRequest(fileId) {
  const p = new Uint8Array(8);
  putU64BE(new DataView(p.buffer), 0, fileId);
  return buildPacket(Module.FILE_TRANSFER, FileCmd.VERIFICATION_RESULT, p);
}

export function buildTransferStop(fileId) {
  const p = new Uint8Array(8);
  putU64BE(new DataView(p.buffer), 0, fileId);
  return buildPacket(Module.FILE_TRANSFER, FileCmd.TRANSFER_STOP, p);
}

export function buildStatusQuery() {
  return buildPacket(Module.FILE_TRANSFER, FileCmd.STATUS);
}

export function parseDeviceInfo(payload) {
  if (!payload || payload.length < 4) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let o = 0;
  const readStr = () => {
    if (o + 4 > payload.length) return '';
    const len = getU32BE(view, o);
    o += 4;
    if (len < 0 || o + len > payload.length) return '';
    const s = new TextDecoder().decode(payload.slice(o, o + len));
    o += len;
    return s;
  };
  const name = readStr();
  const deviceVersion = readStr();
  const protocolVersion = readStr();
  if (o + 20 > payload.length) {
    return { name, deviceVersion, protocolVersion };
  }
  const storageCapacity = getU64BE(view, o);
  const freeStorage = getU64BE(view, o + 8);
  const typeCount = getU32BE(view, o + 16);
  o += 20;
  const fileTypes = [...payload.slice(o, o + typeCount)];
  o += typeCount;
  let maxFileSize = null;
  let features = '';
  if (o + 8 <= payload.length) {
    maxFileSize = getU64BE(view, o);
    o += 8;
    features = readStr();
  }
  return {
    name,
    deviceVersion,
    protocolVersion,
    storageCapacity,
    freeStorage,
    fileTypes,
    maxFileSize,
    features,
  };
}

export function parseMediaIdResponse(payload) {
  if (!payload || payload.length < 9) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const mediaId = getU64BE(view, 0);
  const success = payload[8] !== 0;
  const message = new TextDecoder().decode(payload.slice(9));
  return { mediaId, success, message };
}

export function parseAck(payload) {
  if (!payload || payload.length < 8) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const fileId = getU64BE(view, 0);
  const chunkIndex = payload.length >= 12 ? getU32BE(view, 8) : null;
  return { fileId, chunkIndex };
}

export function parseNack(payload) {
  if (!payload || payload.length < 12) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    fileId: getU64BE(view, 0),
    errorCode: getU32BE(view, 8),
    message: new TextDecoder().decode(payload.slice(12)),
  };
}

export function describePacket(pkt) {
  if (!pkt) return 'null';
  if (pkt.incomplete) return `incomplete (need ${pkt.need})`;
  if (pkt.legacy) {
    return `legacy CD module=0x${pkt.moduleKey.toString(16)} cmd=0x${pkt.command.toString(16)} [${toHex(pkt.raw)}]`;
  }
  const errHint =
    pkt.moduleId === Module.FILE_TRANSFER && pkt.commandId === FileCmd.TRANSFER_NACK
      ? (() => {
          const n = parseNack(pkt.payload);
          return n ? ` err=${ErrorCode[n.errorCode] || n.errorCode} ${n.message}` : '';
        })()
      : '';
  return `${pkt.moduleName}.${pkt.commandName} payload=${pkt.payload.length}B${errHint} | ${toHex(pkt.raw)}`;
}
