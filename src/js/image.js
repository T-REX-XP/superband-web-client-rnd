/**
 * Prepare images for badge push (default dial 360×360 — common round IPS badge).
 */

import { encodeBaselineJpeg444, describeJpeg } from './jpeg444.js';

export const DEFAULT_DIAL = { width: 360, height: 360 };

/**
 * Pack ImageData as RGB565 pixel bytes (row-major).
 * FitPro dial type 0 / JieLi RGB path (dg01-ble upload-dial, BmpConvert NO_PACK).
 * @param {ImageData} imageData
 * @param {{ littleEndian?: boolean }} [opts]
 */
export function encodeRgb565(imageData, { littleEndian = true } = {}) {
  const { data, width, height } = imageData;
  const out = new Uint8Array(width * height * 2);
  const view = new DataView(out.buffer);
  let o = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const rgb565 = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
    view.setUint16(o, rgb565, littleEndian);
    o += 2;
  }
  return out;
}

/**
 * Load a File/Blob into an HTMLImageElement.
 * @param {Blob} blob
 */
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
    };
    img.src = url;
  });
}

/**
 * Cover-crop into dial size and export bytes for badge push.
 * @param {CanvasImageSource} source
 * @param {{width?:number,height?:number,quality?:number,round?:boolean,format?:'rgb565'|'jpeg444'}} opts
 * @returns {Promise<{blob: Blob, bytes: Uint8Array, width: number, height: number, previewUrl: string, format: string}>}
 */
export async function prepareDialImage(source, {
  width = DEFAULT_DIAL.width,
  height = DEFAULT_DIAL.height,
  quality = 0.5,
  round = false,
  /** FitPro BJ/DG default: RGB565 type 0. JPEG only when dial algorithm === 4. */
  format = 'rgb565',
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) throw new Error('Image has no dimensions');

  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  if (round) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, dx, dy, dw, dh);
  if (round) ctx.restore();

  const imageData = ctx.getImageData(0, 0, width, height);
  // Preview always from canvas PNG (accurate colors; JPEG/RGB565 may differ slightly).
  const previewUrl = canvas.toDataURL('image/png');

  if (format === 'jpeg444') {
    // FitPro JpegRulesChecker / TurboJPEG path (algorithm 4 only).
    const q = Math.round(Math.max(1, Math.min(100, (quality <= 1 ? quality * 100 : quality))));
    const bytes = encodeBaselineJpeg444(imageData, { quality: q || 50 });
    const meta = describeJpeg(bytes);
    if (!meta.ok) {
      throw new Error(
        `Dial JPEG failed device rules (jfif=${meta.jfif} 444=${meta.is444} mcu=${meta.mcuOk})`,
      );
    }
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    return { blob, bytes, width, height, previewUrl, format: 'jpeg444', jpeg: meta };
  }

  const bytes = encodeRgb565(imageData, { littleEndian: true });
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  return { blob, bytes, width, height, previewUrl, format: 'rgb565' };
}

/**
 * @param {File} file
 * @param {object} opts
 */
export async function prepareFileForBadge(file, opts = {}) {
  const img = await loadImage(file);
  return prepareDialImage(img, opts);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
