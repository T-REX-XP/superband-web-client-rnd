import { encodeOpaqueEtc2 } from './etc2.js';

const HEADER_SIZE = 0x450;
const BR28 = { magic: 0x52553330, version: 0x00010300, type: 0x24010000 };
const BR35_ETC2 = { magic: 0x52553530, version: 0x00010500, type: 0x00900001 };

function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
  }
  return crc;
}

function checkDimensions(rgba, width, height) {
  if (!Number.isInteger(width) || width < 1 || width > 65535 ||
      !Number.isInteger(height) || height < 1 || height > 65535 ||
      rgba.length !== width * height * 4) throw new RangeError('Invalid image dimensions or RGBA length');
}

/** JieLi BmpConvert mode 1 (BR28 packed RGB565), matched to SuperBand's ARMv7 converter. */
export function encodePackedRgb565(rgba, width, height) {
  checkDimensions(rgba, width, height);
  const rows = [];
  let payloadSize = height * 4;
  for (let y = 0; y < height; y++) {
    const pixels = new Uint16Array(width);
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      pixels[x] = ((rgba[p] & 0xf8) << 8) | ((rgba[p + 1] & 0xfc) << 3) | (rgba[p + 2] >> 3);
    }
    const row = [];
    const word = (value) => row.push(value >> 8, value & 0xff);
    for (let i = 0; i < width;) {
      let repeat = 1;
      while (i + repeat < width && repeat < 127 && pixels[i + repeat] === pixels[i]) repeat++;
      if (repeat >= 3) {
        row.push(0x80 | repeat);
        word(pixels[i]);
        i += repeat;
      } else {
        const start = i++;
        while (i < width && i - start < 127) {
          // Native lookahead stops at the 127-pixel literal window. A repeat
          // crossing that boundary is intentionally absorbed into literals.
          if (i + 2 < width && i + 2 - start < 127 &&
              pixels[i] === pixels[i + 1] && pixels[i] === pixels[i + 2]) break;
          i++;
        }
        row.push(i - start);
        for (let j = start; j < i; j++) word(pixels[j]);
      }
    }
    if (row.length > 0x7ff || payloadSize > 0x1fffff) throw new RangeError('RES row descriptor limit exceeded');
    rows.push(Uint8Array.from(row));
    payloadSize += row.length;
  }
  const output = new Uint8Array(HEADER_SIZE + payloadSize);
  const view = new DataView(output.buffer);
  let offset = height * 4;
  rows.forEach((row, y) => {
    view.setUint32(HEADER_SIZE + y * 4, (row.length << 21) | offset, true);
    output.set(row, HEADER_SIZE + offset);
    offset += row.length;
  });
  writeHeader(output, width, height, BR28);
  return output;
}

/** BR35 container with the ETC2 RGBA8 variant emitted by BmpConvert mode 6. */
export function encodeBr35Etc2(rgba, width, height) {
  checkDimensions(rgba, width, height);
  const payload = encodeOpaqueEtc2(rgba, width, height);
  const output = new Uint8Array(HEADER_SIZE + payload.length);
  output.set(payload, HEADER_SIZE);
  writeHeader(output, width, height, BR35_ETC2);
  return output;
}

function writeHeader(output, width, height, format) {
  const view = new DataView(output.buffer);
  view.setUint32(0, format.magic);
  view.setUint32(4, format.version, true);
  view.setUint32(8, 1, true);
  view.setUint32(0x14, 0x18, true);
  view.setUint32(0x18, 0x30, true);
  view.setUint32(0x1c, 0x00540001, true);
  view.setUint32(0x24, 0x3c, true);
  view.setUint32(0x28, 0x00500001, true);
  view.setUint32(0x30, 0x100, true);
  view.setUint32(0x34, 0x50, true);
  view.setUint32(0x38, 0x400, true);
  view.setUint32(0x40, format.type, true);
  view.setUint16(0x44, width, true);
  view.setUint16(0x46, height, true);
  view.setUint32(0x48, output.length - HEADER_SIZE, true);
  view.setUint32(0x4c, HEADER_SIZE, true);
  view.setUint16(0x3e, crc16(output.subarray(HEADER_SIZE)), true);
  view.setUint16(0x3c, crc16(output.subarray(0x3e, 0x50)), true);
}

export function inspectJieliResource(bytes, algorithm) {
  if (bytes.length < HEADER_SIZE) return null;
  const format = algorithm === 3 ? BR35_ETC2 : BR28;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== format.magic || view.getUint32(4, true) !== format.version ||
      view.getUint32(0x40, true) !== format.type ||
      view.getUint32(0x4c, true) !== HEADER_SIZE) return null;

  const width = view.getUint16(0x44, true);
  const height = view.getUint16(0x46, true);
  const payload = bytes.subarray(HEADER_SIZE);
  if (!width || !height ||
      view.getUint32(0x48, true) !== payload.length ||
      view.getUint16(0x3c, true) !== crc16(bytes.subarray(0x3e, 0x50)) ||
      view.getUint16(0x3e, true) !== crc16(payload)) return null;

  if (format === BR35_ETC2) {
    return payload.length === Math.ceil(width / 4) * Math.ceil(height / 4) * 16
      ? { width, height }
      : null;
  }

  let offset = height * 4;
  if (offset > payload.length) return null;
  for (let y = 0; y < height; y++) {
    const descriptor = view.getUint32(HEADER_SIZE + y * 4, true);
    const end = offset + (descriptor >>> 21);
    if ((descriptor & 0x1fffff) !== offset || end > payload.length) return null;
    let pixels = 0;
    while (offset < end) {
      const tag = payload[offset++];
      const count = tag & 0x7f;
      if (!count) return null;
      pixels += count;
      offset += tag & 0x80 ? 2 : count * 2;
    }
    if (offset !== end || pixels !== width) return null;
  }
  return offset === payload.length ? { width, height } : null;
}
