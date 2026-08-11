/**
 * Baseline JPEG encoder with YCbCr 4:4:4 (no chroma subsampling).
 *
 * Required for FitPro dial push: Android TurboJpegCompressor uses subsample=0
 * (TJSAMP_444). Browser canvas.toBlob() emits 4:2:0, which fails the app's
 * JpegRulesChecker MCU rule on 360×360 (360 % 16 ≠ 0) and shows a black dial.
 *
 * Output: SOI + JFIF APP0 + DQT + SOF0 + DHT + SOS + scan + EOI.
 * No ICC / APP2, no progressive, no restart markers.
 */

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48,
  41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22,
  15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
  62, 63,
];

// Standard JPEG luminance / chrominance quantization (quality-scaled later)
const STD_LUM_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24,
  40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103,
  77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72,
  92, 95, 98, 112, 100, 103, 99,
];

const STD_CHROM_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99,
  99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99,
];

const STD_DC_LUM_NRCODES = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const STD_DC_LUM_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const STD_AC_LUM_NRCODES = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const STD_AC_LUM_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13,
  0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42,
  0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
  0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a,
  0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67,
  0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84,
  0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7,
  0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

const STD_DC_CHROM_NRCODES = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const STD_DC_CHROM_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const STD_AC_CHROM_NRCODES = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const STD_AC_CHROM_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51,
  0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1,
  0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24,
  0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a,
  0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66,
  0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82,
  0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
  0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa,
  0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9,
  0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4,
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

function scaleQuantTable(base, quality) {
  let q = Math.max(1, Math.min(100, quality | 0));
  const scale = q < 50 ? Math.floor(5000 / q) : Math.floor(200 - q * 2);
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const v = Math.floor((base[i] * scale + 50) / 100);
    out[i] = Math.max(1, Math.min(255, v));
  }
  return out;
}

function buildHuffmanTable(nrcodes, values) {
  const codes = new Array(256);
  // nrcodes[0] unused; indices 1..16 are code-length counts (JPEG DHT)
  let code = 0;
  let k = 0;
  for (let i = 1; i <= 16; i++) {
    for (let j = 0; j < nrcodes[i]; j++) {
      codes[values[k]] = { len: i, code };
      k++;
      code++;
    }
    code <<= 1;
  }
  return codes;
}

const HT_DC_Y = buildHuffmanTable(STD_DC_LUM_NRCODES, STD_DC_LUM_VALUES);
const HT_AC_Y = buildHuffmanTable(STD_AC_LUM_NRCODES, STD_AC_LUM_VALUES);
const HT_DC_UV = buildHuffmanTable(STD_DC_CHROM_NRCODES, STD_DC_CHROM_VALUES);
const HT_AC_UV = buildHuffmanTable(STD_AC_CHROM_NRCODES, STD_AC_CHROM_VALUES);

function categoryOf(n) {
  let abs = n < 0 ? -n : n;
  let cat = 0;
  while (abs) {
    abs >>= 1;
    cat++;
  }
  return cat;
}

function bitBits(n, cat) {
  if (n < 0) n = n - 1 + (1 << cat);
  return n & ((1 << cat) - 1);
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.bitbuf = 0;
    this.bitcnt = 0;
  }

  writeBits(code, len) {
    if (len === 0) return;
    this.bitbuf = (this.bitbuf << len) | (code & ((1 << len) - 1));
    this.bitcnt += len;
    while (this.bitcnt >= 8) {
      const b = (this.bitbuf >> (this.bitcnt - 8)) & 0xff;
      this.bytes.push(b);
      if (b === 0xff) this.bytes.push(0x00); // byte stuffing
      this.bitcnt -= 8;
    }
  }

  writeHuffman(ht, symbol) {
    const e = ht[symbol];
    if (!e) throw new Error(`Missing Huffman symbol 0x${symbol.toString(16)}`);
    this.writeBits(e.code, e.len);
  }

  padToByte() {
    if (this.bitcnt > 0) {
      const pad = 8 - this.bitcnt;
      this.writeBits((1 << pad) - 1, pad);
    }
  }

  toUint8Array() {
    return new Uint8Array(this.bytes);
  }
}

/** FDCT on 8×8 float block (in-place AAN-ish / float DCT). */
function fDCT(block) {
  // Based on independent JPEG group's float FDCT (LL&M)
  for (let i = 0; i < 8; i++) {
    const p = i * 8;
    let d0 = block[p];
    let d1 = block[p + 1];
    let d2 = block[p + 2];
    let d3 = block[p + 3];
    let d4 = block[p + 4];
    let d5 = block[p + 5];
    let d6 = block[p + 6];
    let d7 = block[p + 7];
    let tmp0 = d0 + d7;
    let tmp7 = d0 - d7;
    let tmp1 = d1 + d6;
    let tmp6 = d1 - d6;
    let tmp2 = d2 + d5;
    let tmp5 = d2 - d5;
    let tmp3 = d3 + d4;
    let tmp4 = d3 - d4;
    let tmp10 = tmp0 + tmp3;
    let tmp13 = tmp0 - tmp3;
    let tmp11 = tmp1 + tmp2;
    let tmp12 = tmp1 - tmp2;
    block[p] = tmp10 + tmp11;
    block[p + 4] = tmp10 - tmp11;
    let z1 = (tmp12 + tmp13) * 0.707106781;
    block[p + 2] = tmp13 + z1;
    block[p + 6] = tmp13 - z1;
    tmp10 = tmp4 + tmp5;
    tmp11 = tmp5 + tmp6;
    tmp12 = tmp6 + tmp7;
    const z5 = (tmp10 - tmp12) * 0.382683433;
    const z2 = 0.5411961 * tmp10 + z5;
    const z4 = 1.306562965 * tmp12 + z5;
    const z3 = tmp11 * 0.707106781;
    const z11 = tmp7 + z3;
    const z13 = tmp7 - z3;
    block[p + 5] = z13 + z2;
    block[p + 3] = z13 - z2;
    block[p + 1] = z11 + z4;
    block[p + 7] = z11 - z4;
  }
  for (let i = 0; i < 8; i++) {
    let d0 = block[i];
    let d1 = block[i + 8];
    let d2 = block[i + 16];
    let d3 = block[i + 24];
    let d4 = block[i + 32];
    let d5 = block[i + 40];
    let d6 = block[i + 48];
    let d7 = block[i + 56];
    let tmp0 = d0 + d7;
    let tmp7 = d0 - d7;
    let tmp1 = d1 + d6;
    let tmp6 = d1 - d6;
    let tmp2 = d2 + d5;
    let tmp5 = d2 - d5;
    let tmp3 = d3 + d4;
    let tmp4 = d3 - d4;
    let tmp10 = tmp0 + tmp3;
    let tmp13 = tmp0 - tmp3;
    let tmp11 = tmp1 + tmp2;
    let tmp12 = tmp1 - tmp2;
    block[i] = tmp10 + tmp11;
    block[i + 32] = tmp10 - tmp11;
    let z1 = (tmp12 + tmp13) * 0.707106781;
    block[i + 16] = tmp13 + z1;
    block[i + 48] = tmp13 - z1;
    tmp10 = tmp4 + tmp5;
    tmp11 = tmp5 + tmp6;
    tmp12 = tmp6 + tmp7;
    const z5 = (tmp10 - tmp12) * 0.382683433;
    const z2 = 0.5411961 * tmp10 + z5;
    const z4 = 1.306562965 * tmp12 + z5;
    const z3 = tmp11 * 0.707106781;
    const z11 = tmp7 + z3;
    const z13 = tmp7 - z3;
    block[i + 40] = z13 + z2;
    block[i + 24] = z13 - z2;
    block[i + 8] = z11 + z4;
    block[i + 56] = z11 - z4;
  }
}

function quantize(block, qtable) {
  const out = new Int16Array(64);
  // AAN scaling factors for float FDCT output → quantize
  const aan = [
    1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961,
    0.275899379,
  ];
  for (let z = 0; z < 64; z++) {
    const i = ZIGZAG[z];
    const r = i >> 3;
    const c = i & 7;
    const v = block[i] / (aan[r] * aan[c] * 8);
    out[z] = Math.round(v / qtable[i]);
  }
  return out;
}

function encodeDU(bw, coeffs, prevDC, htDC, htAC) {
  let dc = coeffs[0];
  let diff = dc - prevDC;
  if (diff === 0) {
    bw.writeHuffman(htDC, 0);
  } else {
    const cat = categoryOf(diff);
    bw.writeHuffman(htDC, cat);
    bw.writeBits(bitBits(diff, cat), cat);
  }
  // AC
  let end0 = 63;
  while (end0 > 0 && coeffs[end0] === 0) end0--;
  if (end0 === 0) {
    bw.writeHuffman(htAC, 0x00); // EOB
    return dc;
  }
  let i = 1;
  while (i <= end0) {
    let start = i;
    while (i <= end0 && coeffs[i] === 0) i++;
    let run = i - start;
    while (run >= 16) {
      bw.writeHuffman(htAC, 0xf0);
      run -= 16;
    }
    const ac = coeffs[i];
    const cat = categoryOf(ac);
    bw.writeHuffman(htAC, (run << 4) | cat);
    bw.writeBits(bitBits(ac, cat), cat);
    i++;
  }
  if (end0 !== 63) bw.writeHuffman(htAC, 0x00);
  return dc;
}

function writeMarker(out, marker) {
  out.push(0xff, marker);
}

function writeSegment(out, marker, payload) {
  writeMarker(out, marker);
  const len = payload.length + 2;
  out.push((len >> 8) & 0xff, len & 0xff);
  for (let i = 0; i < payload.length; i++) out.push(payload[i]);
}

function writeDQT(out, id, table) {
  const payload = [id];
  for (let i = 0; i < 64; i++) payload.push(table[ZIGZAG[i]]);
  writeSegment(out, 0xdb, payload);
}

function writeDHT(out, isAC, id, nrcodes, values) {
  const payload = [(isAC ? 0x10 : 0x00) | id];
  for (let i = 1; i <= 16; i++) payload.push(nrcodes[i]);
  for (let i = 0; i < values.length; i++) payload.push(values[i]);
  writeSegment(out, 0xc4, payload);
}

/**
 * @param {ImageData| {data: Uint8ClampedArray|Uint8Array, width: number, height: number}} image
 * @param {{ quality?: number }} [opts]
 * @returns {Uint8Array}
 */
export function encodeBaselineJpeg444(image, { quality = 50 } = {}) {
  const width = image.width | 0;
  const height = image.height | 0;
  const rgba = image.data;
  if (!width || !height) throw new Error('Invalid image size');
  if (width % 8 !== 0 || height % 8 !== 0) {
    throw new Error(`JPEG 4:4:4 requires size multiple of 8 (got ${width}×${height})`);
  }

  const yqt = scaleQuantTable(STD_LUM_QUANT, quality);
  const uvqt = scaleQuantTable(STD_CHROM_QUANT, quality);

  const out = [];
  // SOI
  out.push(0xff, 0xd8);
  // JFIF APP0
  writeSegment(out, 0xe0, [
    0x4a, 0x46, 0x49, 0x46, 0x00, // JFIF\0
    0x01, 0x01, // version 1.1
    0x00, // density unit
    0x00, 0x01, 0x00, 0x01, // 1x1 dens
    0x00, 0x00, // no thumbnail
  ]);
  writeDQT(out, 0, yqt);
  writeDQT(out, 1, uvqt);
  // SOF0 — baseline, 8-bit, 3 components, all 4:4:4 (H=1 V=1)
  writeSegment(out, 0xc0, [
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00, // Y: 1x1, QT0
    0x02,
    0x11,
    0x01, // Cb
    0x03,
    0x11,
    0x01, // Cr
  ]);
  writeDHT(out, false, 0, STD_DC_LUM_NRCODES, STD_DC_LUM_VALUES);
  writeDHT(out, true, 0, STD_AC_LUM_NRCODES, STD_AC_LUM_VALUES);
  writeDHT(out, false, 1, STD_DC_CHROM_NRCODES, STD_DC_CHROM_VALUES);
  writeDHT(out, true, 1, STD_AC_CHROM_NRCODES, STD_AC_CHROM_VALUES);
  // SOS
  writeSegment(out, 0xda, [0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);

  const bw = new BitWriter();
  let dcY = 0;
  let dcU = 0;
  let dcV = 0;
  const block = new Float64Array(64);

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      // Y
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(width - 1, bx + x);
          const sy = Math.min(height - 1, by + y);
          const i = (sy * width + sx) * 4;
          const r = rgba[i];
          const g = rgba[i + 1];
          const b = rgba[i + 2];
          block[y * 8 + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
        }
      }
      fDCT(block);
      let coeffs = quantize(block, yqt);
      dcY = encodeDU(bw, coeffs, dcY, HT_DC_Y, HT_AC_Y);

      // Cb
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(width - 1, bx + x);
          const sy = Math.min(height - 1, by + y);
          const i = (sy * width + sx) * 4;
          const r = rgba[i];
          const g = rgba[i + 1];
          const b = rgba[i + 2];
          block[y * 8 + x] = -0.168736 * r - 0.331264 * g + 0.5 * b;
        }
      }
      fDCT(block);
      coeffs = quantize(block, uvqt);
      dcU = encodeDU(bw, coeffs, dcU, HT_DC_UV, HT_AC_UV);

      // Cr
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(width - 1, bx + x);
          const sy = Math.min(height - 1, by + y);
          const i = (sy * width + sx) * 4;
          const r = rgba[i];
          const g = rgba[i + 1];
          const b = rgba[i + 2];
          block[y * 8 + x] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      fDCT(block);
      coeffs = quantize(block, uvqt);
      dcV = encodeDU(bw, coeffs, dcV, HT_DC_UV, HT_AC_UV);
    }
  }

  bw.padToByte();
  const scan = bw.toUint8Array();
  for (let i = 0; i < scan.length; i++) out.push(scan[i]);
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

/** Quick structural check used by tests / UI diagnostics. */
export function describeJpeg(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { ok: false, reason: 'not JPEG' };
  }
  let i = 2;
  let jfif = false;
  let progressive = false;
  let samp = null;
  let width = 0;
  let height = 0;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const m = bytes[i + 1];
    if (m === 0xd9) break;
    if (m === 0xda) break;
    if (m === 0x00 || m === 0xff) {
      i++;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (m === 0xe0 && len >= 7) {
      const tag = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (tag.startsWith('JFIF')) jfif = true;
    }
    if (m === 0xc2) progressive = true;
    if (m === 0xc0 && len >= 17) {
      height = (bytes[i + 5] << 8) | bytes[i + 6];
      width = (bytes[i + 7] << 8) | bytes[i + 8];
      const ySamp = bytes[i + 11];
      const cbSamp = bytes[i + 14];
      const crSamp = bytes[i + 17];
      samp = { y: ySamp, cb: cbSamp, cr: crSamp };
    }
    i += 2 + len;
  }
  const is444 = samp && samp.y === 0x11 && samp.cb === 0x11 && samp.cr === 0x11;
  const mcuOk = is444 ? width % 8 === 0 && height % 8 === 0 : width % 16 === 0 && height % 16 === 0;
  return {
    ok: jfif && !progressive && is444 && mcuOk,
    jfif,
    progressive,
    is444: !!is444,
    width,
    height,
    sampling: samp,
    mcuOk,
  };
}
