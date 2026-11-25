/**
 * Pure-JS MJPG AVI container builder (RIFF / 'AVI ' with MJPG frames).
 *
 * The SuperBand Android app pushes video to FitPro badges as an **MJPG AVI** via
 * the WatchTheme3 dial path (module 0x1F, fileType 1) — see
 * `WatchThemeTransferManager.buildWatchTheme3BodyForVideo()`. This builds that
 * container from per-frame JPEG bytes; no dependencies, no encoder.
 *
 * Ported from `ElectronicCats/jieli-ble-badge-research` → `tools/qix-ble/
 * qix_ble/avi.py` (itself from the `ebadge` CLI / `web-bluetooth-e87`). That
 * reference emits a 52-byte `avih` (dropping `dwReserved[2..3]`); we emit the
 * standard 56-byte `AVIMAINHEADER`, which strict parsers accept and lenient
 * offset-based parsers ignore.
 */

/** @type {{width:number,height:number,fps:number}} */
export const DEFAULT_AVI = { width: 240, height: 240, fps: 12 };

export function isMjpgAvi(bytes) {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x41564920 ||
      view.getUint32(4, true) !== bytes.length - 8) return false;
  for (let offset = 12; offset + 16 <= bytes.length; offset += 2) {
    if (view.getUint32(offset) === 0x73747268 &&
        view.getUint32(offset + 4, true) >= 56 &&
        view.getUint32(offset + 8) === 0x76696473 &&
        view.getUint32(offset + 12) === 0x4d4a5047) return true;
  }
  return false;
}

function fourcc(s) {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4 && i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function u16le(v) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v & 0xffff, true);
  return b;
}

function u32le(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
}

function concat(parts) {
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

/** RIFF chunks must be word-aligned. */
function padEven(data) {
  return data.length & 1 ? concat([data, new Uint8Array(1)]) : data;
}

function chunk(id, data) {
  return concat([fourcc(id), u32le(data.length), padEven(data)]);
}

function listChunk(type, children) {
  const inner = concat([fourcc(type), ...children]);
  return concat([fourcc('LIST'), u32le(inner.length), inner]);
}

/**
 * Build an MJPG AVI from JPEG frames.
 * @param {Array<Uint8Array>} frames raw JPEG bytes (FFD8…FFD9)
 * @param {{width?:number,height?:number,fps?:number}} [opts]
 * @returns {Uint8Array}
 */
export function buildMjpgAvi(frames, opts = {}) {
  const { width = DEFAULT_AVI.width, height = DEFAULT_AVI.height, fps = DEFAULT_AVI.fps } = opts;
  const list = (frames || []).filter((f) => f && f.length);
  if (!list.length) throw new Error('At least one frame is required');

  const totalFrames = list.length;
  const usecPerFrame = fps > 0 ? Math.round(1_000_000 / fps) : 1_000_000;
  let maxFrameSize = 0;
  for (const f of list) if (f.length > maxFrameSize) maxFrameSize = f.length;
  const suggested = maxFrameSize + 8;

  // ── avih (main AVI header, 56 bytes = 14 DWORDs) ──
  const avih = chunk(
    'avih',
    concat([
      u32le(usecPerFrame), // dwMicroSecPerFrame
      u32le(0), // dwMaxBytesPerSec (0 = unconstrained)
      u32le(0), // dwPaddingGranularity
      u32le(0x0110), // dwFlags: AVIF_HASINDEX | AVIF_TRUSTCKTYPE
      u32le(totalFrames), // dwTotalFrames
      u32le(0), // dwInitialFrames
      u32le(1), // dwStreams (video only)
      u32le(suggested), // dwSuggestedBufferSize
      u32le(width),
      u32le(height),
      u32le(0),
      u32le(0),
      u32le(0),
      u32le(0), // dwReserved[0..3]
    ]),
  );

  // ── strh (stream header, 56 bytes) ──
  const strh = chunk(
    'strh',
    concat([
      fourcc('vids'), // fccType
      fourcc('MJPG'), // fccHandler
      u32le(0), // dwFlags
      u16le(0), // wPriority
      u16le(0), // wLanguage
      u32le(0), // dwInitialFrames
      u32le(1), // dwScale
      u32le(fps), // dwRate
      u32le(0), // dwStart
      u32le(totalFrames), // dwLength
      u32le(suggested), // dwSuggestedBufferSize
      u32le(0), // dwQuality
      u32le(0), // dwSampleSize
      u16le(0), // rcFrame.left
      u16le(0), // rcFrame.top
      u16le(width), // rcFrame.right
      u16le(height), // rcFrame.bottom
    ]),
  );

  // ── strf (BITMAPINFOHEADER, 40 bytes) ──
  const strf = chunk(
    'strf',
    concat([
      u32le(40), // biSize
      u32le(width), // biWidth
      u32le(height), // biHeight (positive = bottom-up)
      u16le(1), // biPlanes
      u16le(24), // biBitCount
      u32le(0x47504a4d), // biCompression = 'MJPG'
      u32le((width * height * 3) >>> 0), // biSizeImage
      u32le(0), // biXPelsPerMeter
      u32le(0), // biYPelsPerMeter
      u32le(0), // biClrUsed
      u32le(0), // biClrImportant
    ]),
  );

  const hdrl = listChunk('hdrl', [avih, listChunk('strl', [strh, strf])]);

  // ── movi list + idx1 index ──
  const moviParts = [];
  const idx1Parts = [];
  let moviOffset = 4; // offset from start of movi data (after the 'movi' fourcc)
  for (const frame of list) {
    const padded = padEven(frame);
    moviParts.push(concat([fourcc('00dc'), u32le(frame.length), padded]));
    idx1Parts.push(
      concat([
        fourcc('00dc'),
        u32le(0x10), // AVIIF_KEYFRAME
        u32le(moviOffset),
        u32le(frame.length),
      ]),
    );
    moviOffset += 8 + padded.length;
  }
  const movi = listChunk('movi', moviParts);
  const idx1 = chunk('idx1', concat(idx1Parts));

  const riffData = concat([fourcc('AVI '), hdrl, movi, idx1]);
  return concat([fourcc('RIFF'), u32le(riffData.length), riffData]);
}
