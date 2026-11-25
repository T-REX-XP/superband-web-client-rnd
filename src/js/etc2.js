// ETC2 RGBA8 blocks with opaque EAC alpha and ETC1-compatible individual color mode.
const MODIFIERS = [
  [2, 8, -2, -8], [5, 17, -5, -17], [9, 29, -9, -29], [13, 42, -13, -42],
  [18, 60, -18, -60], [24, 80, -24, -80], [33, 106, -33, -106], [47, 183, -47, -183],
];

const clamp = (n) => Math.max(0, Math.min(255, n));

function encodeHalf(rgb, flip, half) {
  const channels = [0, 0, 0];
  const indices = Array.from({ length: 8 }, (_, i) => flip ? (i >> 1) * 4 + (i & 1) + 2 * half : i + 8 * half);
  for (const index of indices) {
    for (let c = 0; c < 3; c++) channels[c] += rgb[index * 3 + c];
  }
  const [r, g, b] = channels.map((sum) => Math.round(sum / (8 * 17)));
  let best = { error: Infinity };
  for (let table = 0; table < MODIFIERS.length; table++) {
    const colors = MODIFIERS[table].map((d) => [clamp(r * 17 + d), clamp(g * 17 + d), clamp(b * 17 + d)]);
    let error = 0;
    let selectors = 0;
    for (const index of indices) {
      let minError = Infinity;
      let selector = 0;
      for (let i = 0; i < colors.length; i++) {
        const [pr, pg, pb] = colors[i];
        const dr = rgb[index * 3] - pr;
        const dg = rgb[index * 3 + 1] - pg;
        const db = rgb[index * 3 + 2] - pb;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < minError) {
          minError = distance;
          selector = i;
        }
      }
      error += minError;
      selectors |= ((selector & 1) << index) | ((selector >> 1) << (16 + index));
    }
    if (error < best.error) best = { r, g, b, table, selectors, error };
  }
  return best;
}

export function encodeOpaqueEtc2(rgba, width, height) {
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const bytes = new Uint8Array(blocksWide * blocksHigh * 16);
  const view = new DataView(bytes.buffer);
  const rgb = new Uint8Array(16 * 3);
  let offset = 0;

  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          const source = (Math.min(by * 4 + y, height - 1) * width + Math.min(bx * 4 + x, width - 1)) * 4;
          const target = (x * 4 + y) * 3;
          rgb[target] = rgba[source];
          rgb[target + 1] = rgba[source + 1];
          rgb[target + 2] = rgba[source + 2];
        }
      }

      let left = encodeHalf(rgb, false, 0);
      let right = encodeHalf(rgb, false, 1);
      const top = encodeHalf(rgb, true, 0);
      const bottom = encodeHalf(rgb, true, 1);
      const flip = top.error + bottom.error < left.error + right.error;
      if (flip) {
        left = top;
        right = bottom;
      }

      bytes[offset] = 255;
      bytes[offset + 8] = (left.r << 4) | right.r;
      bytes[offset + 9] = (left.g << 4) | right.g;
      bytes[offset + 10] = (left.b << 4) | right.b;
      bytes[offset + 11] = (left.table << 5) | (right.table << 2) | Number(flip);
      view.setUint32(offset + 12, left.selectors | right.selectors);
      offset += 16;
    }
  }
  return bytes;
}
