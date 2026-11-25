/**
 * Turn a GIF / APNG / WebP (animated image) or a video file into JPEG frames,
 * then build an MJPG AVI for FitPro dial push (see ./avi.js).
 *
 * - Animated images: `ImageDecoder` (Chrome 94+), which handles GIF/WebP/APNG
 *   frame timing natively.
 * - Video files: a hidden `<video>` element, seeking at a fixed frame rate.
 *   Codec support is whatever the browser can play (H.264 MP4 works in Chrome).
 *
 * Frames are decoded once into target-sized `ImageBitmap`s so they can be
 * re-encoded at several JPEG qualities / frame rates until the AVI fits the
 * badge's storage budget (`fitAvi`).
 */

import { buildMjpgAvi, DEFAULT_AVI } from './avi.js';

export const WATCH_VIDEO = {
  fps: 12,
  /** Clamp captured animation length (seconds). Badge spec: videos under 5 s. */
  maxSeconds: 5,
  /** Default JPEG quality per frame (auto-reduced to meet the size budget). */
  quality: 0.55,
  /** Hard cap on frame count (upload size guard). 5 s @ 24 fps. */
  maxFrames: 120,
  /** Default AVI size budget in bytes (badges often have well under 1 MB free). */
  maxBytes: 700 * 1024,
};

const ANIMATED_EXT = /\.(gif|webp|apng|avif)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|avi|mkv|wmv|flv|3gp)$/i;

function extOf(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function isAnimatedImage(file) {
  const type = (file?.type || '').toLowerCase();
  return /^image\/(gif|webp|apng|avif)/.test(type) || ANIMATED_EXT.test(file?.name || '');
}

export function isSupportedVideoFile(file) {
  const type = (file?.type || '').toLowerCase();
  return isAnimatedImage(file) || /^video\//.test(type) || VIDEO_EXT.test(file?.name || '');
}

function detectAnimatedMime(name) {
  const map = { gif: 'image/gif', webp: 'image/webp', apng: 'image/apng', avif: 'image/avif' };
  return map[extOf(name)] || 'image/gif';
}

/** Cover-crop `source` into the target size, optional round mask. */
function drawCover(ctx, source, sw, sh, width, height, round) {
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (round) {
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, dx, dy, dw, dh);
  ctx.restore();
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('JPEG encode failed'));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      'image/jpeg',
      quality,
    );
  });
}

function seekVideo(video, t) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 2000);
    video.addEventListener('seeked', finish);
    try {
      const dur = Number.isFinite(video.duration) ? video.duration : t + 0.001;
      video.currentTime = Math.min(t, Math.max(0, dur - 0.001));
    } catch {
      finish();
    }
  });
}

async function makeSource(canvas) {
  return createImageBitmap(canvas);
}

async function extractAnimatedImage(file, cfg, onProgress) {
  if (typeof ImageDecoder === 'undefined') {
    throw new Error(
      'This browser lacks ImageDecoder — use Chrome/Edge for GIF/WebP, or push an MP4/H.264 video.',
    );
  }
  const data = await file.arrayBuffer();
  const type = file.type && /image\//.test(file.type) ? file.type : detectAnimatedMime(file.name);
  const decoder = new ImageDecoder({ data, type });
  const sources = [];
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount || 1;
    const budget = Math.max(
      1,
      Math.min(cfg.maxFrames, Math.floor(cfg.fps * cfg.maxSeconds)),
    );

    const canvas = document.createElement('canvas');
    canvas.width = cfg.width;
    canvas.height = cfg.height;
    const ctx = canvas.getContext('2d');

    let previewUrl = null;
    const sampleInterval = 1_000_000 / cfg.fps;
    let frameEnd = 0;
    for (let i = 0; i < frameCount && sources.length < budget; i++) {
      const { image } = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
      try {
        frameEnd += image.duration > 0 ? image.duration : sampleInterval;
        if (sources.length * sampleInterval >= frameEnd) continue;
        drawCover(ctx, image, image.displayWidth, image.displayHeight, cfg.width, cfg.height, cfg.round);
        if (!previewUrl) previewUrl = canvas.toDataURL('image/png');
        const frame = await makeSource(canvas);
        while (sources.length < budget && sources.length * sampleInterval < frameEnd) {
          sources.push(frame);
        }
        onProgress?.(sources.length / budget);
      } finally {
        image.close();
      }
    }
    return { sources, previewUrl, source: 'animated-image', sourceFrames: frameCount };
  } catch (error) {
    for (const source of new Set(sources)) source.close();
    throw error;
  } finally {
    decoder.close?.();
  }
}

async function extractVideoFile(file, cfg, onProgress) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Failed to decode video (unsupported codec?)'));
    });

    const duration = Number.isFinite(video.duration) ? video.duration : cfg.maxSeconds;
    const span = Math.min(duration || cfg.maxSeconds, cfg.maxSeconds);
    const budget = Math.max(1, Math.min(cfg.maxFrames, Math.round(cfg.fps * span)));

    const canvas = document.createElement('canvas');
    canvas.width = cfg.width;
    canvas.height = cfg.height;
    const ctx = canvas.getContext('2d');

    const sources = [];
    let previewUrl = null;
    for (let i = 0; i < budget; i++) {
      const t = budget > 1 ? (i / budget) * span : 0;
      await seekVideo(video, t);
      drawCover(ctx, video, video.videoWidth, video.videoHeight, cfg.width, cfg.height, cfg.round);
      if (!previewUrl) previewUrl = canvas.toDataURL('image/png');
      sources.push(await makeSource(canvas));
      onProgress?.((i + 1) / budget);
    }
    return { sources, previewUrl, source: 'video', duration: span };
  } finally {
    video.removeAttribute('src');
    video.load?.();
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode a GIF/animated image or video into target-sized frame bitmaps.
 * @param {File} file
 * @param {{width?:number,height?:number,fps?:number,maxSeconds?:number,round?:boolean,maxFrames?:number}} [opts]
 * @param {(fraction:number)=>void} [onProgress]
 */
export async function extractFramesForBadge(file, opts = {}, onProgress) {
  const cfg = {
    width: opts.width ?? DEFAULT_AVI.width,
    height: opts.height ?? DEFAULT_AVI.height,
    fps: Math.min(30, Math.max(1, opts.fps ?? WATCH_VIDEO.fps)),
    maxSeconds: Math.min(WATCH_VIDEO.maxSeconds, Math.max(0.5, opts.maxSeconds ?? WATCH_VIDEO.maxSeconds)),
    round: opts.round ?? false,
    maxFrames: opts.maxFrames ?? WATCH_VIDEO.maxFrames,
  };
  if (isAnimatedImage(file)) return extractAnimatedImage(file, cfg, onProgress);
  return extractVideoFile(file, cfg, onProgress);
}

async function encodeFrames(sources, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = [];
  for (const src of sources) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(src, 0, 0, width, height);
    out.push(await canvasToJpeg(canvas, quality));
  }
  return out;
}

/**
 * Encode frame bitmaps into an MJPG AVI that fits `maxBytes`. Tries the
 * requested quality first, then lower JPEG qualities, then drops frames
 * (halving effective FPS) until it fits — returning the smallest attempt if
 * nothing fits.
 *
 * @param {ImageBitmap[]} sources
 * @param {{width:number,height:number,fps:number,quality?:number,maxBytes?:number}} opts
 * @returns {Promise<{avi:Uint8Array,fps:number,quality:number,frameCount:number,bytes:number}>}
 */
export async function fitAvi(sources, opts = {}) {
  const { width = DEFAULT_AVI.width, height = DEFAULT_AVI.height, fps = WATCH_VIDEO.fps } = opts;
  const maxBytes = opts.maxBytes ?? WATCH_VIDEO.maxBytes;
  const base = opts.quality ?? WATCH_VIDEO.quality;
  if (!sources?.length) throw new Error('No frames to encode');

  const qualities = [...new Set([base, 0.5, 0.4, 0.3].filter((q) => q > 0.05))].sort(
    (a, b) => b - a,
  );
  const steps = [1, 2, 3, 4];
  let best = null;

  for (const step of steps) {
    const frames = step === 1 ? sources : sources.filter((_, i) => i % step === 0);
    if (frames.length < 2 && sources.length >= 2) continue;
    const effFps = Math.max(1, Math.round(fps / step));
    for (const quality of qualities) {
      const jpegs = await encodeFrames(frames, width, height, quality);
      const avi = buildMjpgAvi(jpegs, { width, height, fps: effFps });
      const result = { avi, fps: effFps, quality, frameCount: frames.length, bytes: avi.length };
      if (!best || result.bytes < best.bytes) best = result;
      if (!maxBytes || result.bytes <= maxBytes) return result;
    }
  }
  return best;
}
