/**
 * Prepare images for badge push (default dial 360×360 — common round IPS badge).
 */

import { encodeBaselineJpeg444, describeJpeg } from './jpeg444.js';

export const DEFAULT_DIAL = { width: 360, height: 360 };

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
 * Cover-crop into dial size and export JPEG.
 * @param {CanvasImageSource} source
 * @param {{width?:number,height?:number,quality?:number,round?:boolean}} opts
 * @returns {Promise<{blob: Blob, bytes: Uint8Array, width: number, height: number, previewUrl: string}>}
 */
export async function prepareDialImage(source, {
  width = DEFAULT_DIAL.width,
  height = DEFAULT_DIAL.height,
  quality = 0.5,
  round = false,
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

  // FitPro JpegRulesChecker / TurboJPEG path requires baseline JFIF 4:4:4.
  // canvas.toBlob() emits 4:2:0 (+ often ICC) → MCU fail on 360×360 → black dial.
  const q = Math.round(Math.max(1, Math.min(100, (quality <= 1 ? quality * 100 : quality))));
  const imageData = ctx.getImageData(0, 0, width, height);
  const bytes = encodeBaselineJpeg444(imageData, { quality: q || 50 });
  const meta = describeJpeg(bytes);
  if (!meta.ok) {
    throw new Error(
      `Dial JPEG failed device rules (jfif=${meta.jfif} 444=${meta.is444} mcu=${meta.mcuOk})`,
    );
  }

  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const previewUrl = URL.createObjectURL(blob);
  return { blob, bytes, width, height, previewUrl, jpeg: meta };
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
