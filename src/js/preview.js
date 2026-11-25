/**
 * Live viewfinder / realtime preview — product `0x27` (39).
 *
 * Lets the badge display the live camera feed from the host (the advertised
 * "remote camera / viewfinder" feature), and lets the badge open the host's
 * photo page and take remote pictures.
 *
 * Reconstructed from SuperBand 1.10.04 (`com.legend.mywatch` SDK:
 * `realtimepreview/protocol/PreviewConstants`, `PreviewCommandBuilder`,
 * `ImagePacketBuilder`, `transport/PreviewSender`, `bluetooth/ReceiveData.k`).
 *
 * Wire summary:
 *   app → dev  start        CD 00 05 27 01 00 00 00 00
 *   dev → app  start resp   CD .. .. 27 01 00 00 05 <st> <w:u16BE> <h:u16BE>
 *   app → dev  image frame  AA BB CC DD EE FF | u32BE(len) | <jpeg> | FF EE DD CC BB AA
 *   dev → app  end cmd      CD .. .. 27 01 01 00 00            (stop)
 *                           CD .. .. 27 01 01 00 01 <st>       (stop, status)
 *   app → dev  end response CD 00 06 27 01 01 00 01 <st>
 *   app → dev  stop         AA BB CC DD EE FF | 00 00 00 00 | FF EE DD CC BB AA
 */

/** Preview constants (`PreviewConstants`). */
export const PREVIEW = {
  PRODUCT_ID: 0x27,
  START_FLAG: 0xcd,
  VERSION: 0x01,
  /** Function module at frame[5]. */
  MODULE_START: 0x00,
  MODULE_END: 0x01,
  DEFAULT_WIDTH: 240,
  DEFAULT_HEIGHT: 296,
  DEFAULT_FPS: 10,
  DEFAULT_QUALITY: 0.7,
  /** Chunk size for the raw image frame (Android used MTU-derived ≈ 200–500). */
  DEFAULT_CHUNK: 200,
  STATUS_SUCCESS: 0,
  STATUS_FAILED: 1,
};

export const PREVIEW_IMAGE_START = Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff);
export const PREVIEW_IMAGE_END = Uint8Array.of(0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa);

/** `CD 00 05 27 01 00 00 00 00` — begin the preview stream. */
export function buildPreviewStart() {
  return Uint8Array.of(0xcd, 0x00, 0x05, 0x27, 0x01, 0x00, 0x00, 0x00, 0x00);
}

/** `CD 00 06 27 01 01 00 01 <st>` — acknowledge a device end command. */
export function buildPreviewEndResponse(status = PREVIEW.STATUS_SUCCESS) {
  return Uint8Array.of(0xcd, 0x00, 0x06, 0x27, 0x01, 0x01, 0x00, 0x01, status & 0xff);
}

/** `AA BB CC DD EE FF 00 00 00 00 FF EE DD CC BB AA` — end the stream. */
export function buildPreviewStop() {
  const out = new Uint8Array(6 + 4 + 6);
  out.set(PREVIEW_IMAGE_START, 0);
  out.set(PREVIEW_IMAGE_END, 10);
  return out;
}

/**
 * Wrap a JPEG frame for the badge display:
 *   AA BB CC DD EE FF | u32BE(jpeg.length) | jpeg | FF EE DD CC BB AA
 */
export function buildPreviewFrame(jpeg) {
  const n = jpeg.length;
  const out = new Uint8Array(6 + 4 + n + 6);
  out.set(PREVIEW_IMAGE_START, 0);
  out[6] = (n >>> 24) & 0xff;
  out[7] = (n >>> 16) & 0xff;
  out[8] = (n >>> 8) & 0xff;
  out[9] = n & 0xff;
  out.set(jpeg, 10);
  out.set(PREVIEW_IMAGE_END, 10 + n);
  return out;
}

/** True for the device's start response (function module 0, product 0x27). */
export function isPreviewStartResponse(pkt) {
  return (
    pkt &&
    (pkt.dialect === 'fitpro' || pkt.legacy || pkt.dialect === 'baji') &&
    (pkt.moduleId === PREVIEW.PRODUCT_ID || pkt.moduleKey === PREVIEW.PRODUCT_ID) &&
    pkt.commandId === PREVIEW.MODULE_START
  );
}

/** True for the device's end command (function module 1, product 0x27). */
export function isPreviewEndCommand(pkt) {
  return (
    pkt &&
    (pkt.dialect === 'fitpro' || pkt.legacy || pkt.dialect === 'baji') &&
    (pkt.moduleId === PREVIEW.PRODUCT_ID || pkt.moduleKey === PREVIEW.PRODUCT_ID) &&
    pkt.commandId === PREVIEW.MODULE_END
  );
}

/**
 * Parse the start response payload: `status(1) | width(u16BE) | height(u16BE)`.
 * @returns {{ status:number, width:number, height:number, ok:boolean }|null}
 */
export function parsePreviewStartResponse(payload) {
  if (!payload || payload.length < 5) return null;
  const status = payload[0];
  const width = ((payload[1] & 0xff) << 8) | (payload[2] & 0xff);
  const height = ((payload[3] & 0xff) << 8) | (payload[4] & 0xff);
  return {
    status,
    width: width || PREVIEW.DEFAULT_WIDTH,
    height: height || PREVIEW.DEFAULT_HEIGHT,
    ok: status === PREVIEW.STATUS_SUCCESS,
  };
}
