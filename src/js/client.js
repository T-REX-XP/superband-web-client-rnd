import { SuperBandBle } from './ble.js';
import {
  Module,
  FileCmd,
  MediaCmd,
  SysCmd,
  FileType,
  FunctionType,
  PROTOCOL,
  ErrorCode,
  buildDeviceInfoRequest,
  buildMediaIdRequest,
  buildMediaListRequest,
  buildMediaDelete,
  buildTransferStart,
  buildFileData,
  buildTransferComplete,
  buildVerificationRequest,
  buildTransferStop,
  buildStatusQuery,
  buildPairingFrame,
  crc32,
  parseDeviceInfo,
  parseMediaIdResponse,
  parseAck,
  parseNack,
} from './protocol.js';

/**
 * High-level SuperBand badge client (Baji over Web Bluetooth).
 */
export class SuperBandClient extends EventTarget {
  constructor() {
    super();
    this.ble = null;
    this.deviceInfo = null;
    this.disInfo = null;
    this.battery = null;
    this.mediaId = null;
    this._fileId = 1n;
    this._waiters = new Map();
    this._transferring = false;
  }

  get connected() {
    return !!this.ble?.connected;
  }

  get name() {
    return this.ble?.device?.name || this.deviceInfo?.name || null;
  }

  /** Merged glance snapshot for the UI (DIS + Baji + battery). */
  getSnapshot() {
    const dis = this.disInfo || {};
    const baji = this.deviceInfo || {};
    return {
      connected: this.connected,
      name: this.name,
      model: dis.model || baji.name || null,
      firmware: dis.firmware || baji.deviceVersion || null,
      hardware: dis.hardware || null,
      software: dis.software || null,
      manufacturer: dis.manufacturer || null,
      serial: dis.serial || null,
      protocol: baji.protocolVersion || null,
      battery: this.battery,
      freeStorage: baji.freeStorage ?? null,
      storageCapacity: baji.storageCapacity ?? null,
      maxFileSize: baji.maxFileSize ?? null,
      features: baji.features || null,
      mediaId: this.mediaId,
    };
  }

  _emitSnapshot() {
    this._emit('snapshot', { snapshot: this.getSnapshot() });
  }

  static supported() {
    return SuperBandBle.supported();
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _log(msg, level = 'info') {
    this._emit('log', { msg, level, ts: Date.now() });
  }

  _waitFor(predicate, { timeoutMs = 15000, label = 'response' } = {}) {
    return new Promise((resolve, reject) => {
      const id = Symbol(label);
      const timer = setTimeout(() => {
        this._waiters.delete(id);
        reject(new Error(`Timeout waiting for ${label}`));
      }, timeoutMs);
      this._waiters.set(id, {
        predicate,
        resolve: (pkt) => {
          clearTimeout(timer);
          this._waiters.delete(id);
          resolve(pkt);
        },
      });
    });
  }

  _onPacket(pkt) {
    this._emit('packet', { packet: pkt });

    if (pkt.moduleId === Module.SYSTEM && pkt.commandId === SysCmd.DEVICE_INFO_RESPONSE) {
      const info = parseDeviceInfo(pkt.payload);
      if (info) {
        this.deviceInfo = info;
        this._emit('deviceinfo', { info });
      }
    }

    if (pkt.moduleId === Module.MEDIA && pkt.commandId === MediaCmd.ID_RESPONSE) {
      const r = parseMediaIdResponse(pkt.payload);
      if (r?.success) {
        this.mediaId = Number(r.mediaId);
        this._emit('mediaid', { mediaId: this.mediaId, message: r.message });
      }
    }

    for (const [, w] of this._waiters) {
      if (w.predicate(pkt)) {
        w.resolve(pkt);
        break;
      }
    }
  }

  async connect({ acceptAll = false } = {}) {
    this.ble = new SuperBandBle({
      onLog: ({ msg, level }) => this._log(msg, level),
      onPacket: (pkt) => this._onPacket(pkt),
      onConnectionChange: (on) => {
        if (!on) {
          this.deviceInfo = null;
          this.disInfo = null;
          this.battery = null;
          this.mediaId = null;
        }
        this._emit('connection', { connected: on, name: this.name });
        this._emitSnapshot();
      },
    });

    await this.ble.connect({ acceptAll });
    await this.refreshIdentity();
    return this;
  }

  /**
   * Battery + DIS (always) and best-effort Baji DEVICE_INFO.
   * Push/media do not require Baji info — DIS is enough for glance fields.
   */
  async refreshIdentity() {
    this.battery = await this.ble.readBattery();
    if (this.battery != null) this._emit('battery', { level: this.battery });

    this.disInfo = await this.ble.readDeviceInformation();
    this._emit('disinfo', { info: this.disInfo });
    this._emitSnapshot();

    try {
      await this.refreshDeviceInfo({ timeoutMs: 6000 });
    } catch (e) {
      this._log(
        `Baji device info unavailable (${e.message}) — using DIS / GAP for details`,
        'warn',
      );
    }
    this._emitSnapshot();
    return this.getSnapshot();
  }

  async disconnect() {
    await this.ble?.disconnect();
    this.ble = null;
  }

  async write(bytes, label) {
    if (!this.connected) throw new Error('Not connected');
    return this.ble.write(bytes, label);
  }

  async refreshDeviceInfo({ timeoutMs = 10000 } = {}) {
    await this.write(buildDeviceInfoRequest(), 'DEVICE_INFO_REQUEST');
    const pkt = await this._waitFor(
      (p) => p.moduleId === Module.SYSTEM && p.commandId === SysCmd.DEVICE_INFO_RESPONSE,
      { timeoutMs, label: 'DEVICE_INFO_RESPONSE' },
    );
    const info = parseDeviceInfo(pkt.payload);
    this.deviceInfo = info;
    this._emit('deviceinfo', { info });
    this._emitSnapshot();
    return info;
  }

  async pair() {
    await this.write(buildPairingFrame(), 'legacy pair');
  }

  async allocateMediaId({ timeoutMs = 30000 } = {}) {
    await this.write(buildMediaIdRequest(), 'MEDIA_ID_REQUEST');
    const pkt = await this._waitFor(
      (p) => p.moduleId === Module.MEDIA && p.commandId === MediaCmd.ID_RESPONSE,
      { timeoutMs, label: 'MEDIA_ID_RESPONSE' },
    );
    const r = parseMediaIdResponse(pkt.payload);
    if (!r?.success) throw new Error(r?.message || 'Media ID allocation failed');
    this.mediaId = Number(r.mediaId);
    this._emit('mediaid', { mediaId: this.mediaId, message: r.message });
    this._emitSnapshot();
    return this.mediaId;
  }

  async requestMediaList({ timeoutMs = 15000 } = {}) {
    await this.write(buildMediaListRequest(), 'MEDIA_LIST_REQUEST');
    const pkt = await this._waitFor(
      (p) => p.moduleId === Module.MEDIA && p.commandId === MediaCmd.LIST_RESPONSE,
      { timeoutMs, label: 'MEDIA_LIST_RESPONSE' },
    );
    const items = parseMediaList(pkt.payload);
    this._emit('medialist', { items, raw: pkt.payload });
    return items;
  }

  async deleteMedia(mediaId, { timeoutMs = 15000 } = {}) {
    await this.write(buildMediaDelete(mediaId), 'MEDIA_DELETE');
    try {
      const pkt = await this._waitFor(
        (p) => p.moduleId === Module.MEDIA && p.commandId === MediaCmd.DELETE,
        { timeoutMs, label: 'MEDIA_DELETE response' },
      );
      return pkt;
    } catch {
      return null;
    }
  }

  async queryTransferStatus() {
    await this.write(buildStatusQuery(), 'STATUS');
  }

  /**
   * Upload bytes to the badge via Baji file transfer.
   * @param {Uint8Array} fileBytes
   * @param {object} opts
   */
  async transferFile(fileBytes, {
    fileType = FileType.IMAGE,
    functionType = FunctionType.BACKGROUND,
    mediaId = null,
    allocateId = true,
    onProgress = null,
  } = {}) {
    if (this._transferring) throw new Error('Transfer already in progress');
    this._transferring = true;

    try {
      let mid = mediaId ?? this.mediaId;
      if (mid == null || allocateId) {
        mid = await this.allocateMediaId();
      }

      const localFileId = this._fileId++;
      const checksum = crc32(fileBytes);
      this._log(
        `Transfer size=${fileBytes.length} crc=0x${checksum.toString(16)} mediaId=${mid}`,
        'info',
      );
      this._emit('transfer', { phase: 'start', mediaId: mid, size: fileBytes.length, checksum });

      await this.write(
        buildTransferStart({
          fileSize: fileBytes.length,
          fileType,
          functionType,
          mediaId: mid,
        }),
        'TRANSFER_START',
      );

      const ackPkt = await this._waitFor(
        (p) =>
          p.moduleId === Module.FILE_TRANSFER &&
          (p.commandId === FileCmd.TRANSFER_ACK || p.commandId === FileCmd.TRANSFER_NACK),
        { timeoutMs: 30000, label: 'TRANSFER_ACK' },
      );

      if (ackPkt.commandId === FileCmd.TRANSFER_NACK) {
        const n = parseNack(ackPkt.payload);
        const name = ErrorCode[n?.errorCode] || n?.errorCode;
        throw new Error(`Transfer NACK: ${name} ${n?.message || ''}`);
      }

      const ack = parseAck(ackPkt.payload);
      const fileId = ack?.fileId != null ? ack.fileId : localFileId;

      const chunkSize = PROTOCOL.MAX_CHUNK;
      const totalChunks = Math.max(1, Math.ceil(fileBytes.length / chunkSize));

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileBytes.length);
        const slice = fileBytes.slice(start, end);
        await this.write(
          buildFileData({
            fileId,
            chunkIndex: i,
            data: slice,
            isLast: end >= fileBytes.length,
          }),
          `FILE_DATA[${i}]`,
        );
        const pct = Math.round(((i + 1) / totalChunks) * 92);
        onProgress?.(pct, i + 1, totalChunks);
        this._emit('transfer', { phase: 'chunk', index: i, total: totalChunks, percent: pct });

        await Promise.race([
          this._waitFor(
            (p) =>
              p.moduleId === Module.FILE_TRANSFER &&
              (p.commandId === FileCmd.NEXT_CHUNK ||
                p.commandId === FileCmd.RETRY ||
                p.commandId === FileCmd.TRANSFER_ACK),
            { timeoutMs: 60, label: 'chunk-flow' },
          ).catch(() => null),
          new Promise((r) => setTimeout(r, 16)),
        ]);
      }

      await this.write(buildTransferComplete(fileId, checksum), 'TRANSFER_COMPLETE');
      await this.write(buildVerificationRequest(fileId), 'VERIFICATION_RESULT');

      let verified = null;
      try {
        const ver = await this._waitFor(
          (p) =>
            p.moduleId === Module.FILE_TRANSFER && p.commandId === FileCmd.VERIFICATION_RESULT,
          { timeoutMs: 30000, label: 'VERIFICATION_RESULT' },
        );
        verified = ver.payload.length >= 9 ? ver.payload[8] === 1 : null;
      } catch (e) {
        this._log(`Verification wait: ${e.message}`, 'warn');
      }

      onProgress?.(100, totalChunks, totalChunks);
      this._emit('transfer', {
        phase: 'complete',
        fileId,
        mediaId: mid,
        checksum,
        verified,
      });
      return { fileId, mediaId: mid, checksum, verified };
    } finally {
      this._transferring = false;
    }
  }

  async stopTransfer() {
    await this.write(buildTransferStop(this._fileId), 'TRANSFER_STOP');
  }
}

/**
 * Best-effort media list parser (device response layout from RnD notes).
 * Returns as many complete records as fit; tolerates truncated tails.
 */
export function parseMediaList(payload) {
  if (!payload?.length) return [];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const items = [];
  let o = 0;
  const decoder = new TextDecoder();

  while (o + 8 + 4 <= payload.length) {
    const start = o;
    try {
      const mediaId = Number(
        (BigInt(view.getUint32(o, false)) << 32n) | BigInt(view.getUint32(o + 4, false)),
      );
      o += 8;
      const nameLen = view.getUint32(o, false);
      o += 4;
      if (nameLen > 1024 || o + nameLen > payload.length) {
        o = start + 1;
        continue;
      }
      const name = decoder.decode(payload.slice(o, o + nameLen));
      o += nameLen;
      if (o + 4 + 1 + 4 + 4 + 4 + 4 + 4 > payload.length) break;
      const fileSize = view.getUint32(o, false);
      o += 4;
      const fileType = payload[o];
      o += 1;
      const checksum = view.getUint32(o, false);
      o += 4;
      const timestamp = view.getUint32(o, false);
      o += 4;
      const previewSize = view.getUint32(o, false);
      o += 4;
      const backgroundSize = view.getUint32(o, false);
      o += 4;
      const metaLen = view.getUint32(o, false);
      o += 4;
      if (metaLen > 4096 || o + metaLen > payload.length) break;
      const metadata = decoder.decode(payload.slice(o, o + metaLen));
      o += metaLen;
      items.push({
        mediaId,
        name,
        fileSize,
        fileType,
        checksum,
        timestamp,
        previewSize,
        backgroundSize,
        metadata,
      });
    } catch {
      break;
    }
  }
  return items;
}

export { FileType, FunctionType, PROTOCOL };
