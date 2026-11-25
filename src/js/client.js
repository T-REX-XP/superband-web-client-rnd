import { SuperBandBle } from './ble.js';
import { isMjpgAvi } from './avi.js';
import { inspectJieliResource } from './jieli-image.js';
import { describeJpeg } from './jpeg444.js';
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
  toHex,
} from './protocol.js';
import {
  FitPro,
  buildDialInfoRequest,
  buildDialStatusRequest,
  buildDialRemainSpaceRequest,
  parseDialRemainSpace,
  buildDialStart,
  buildDialStartPayload,
  buildDialDataChunk,
  buildDialFinish,
  buildDialFileBlob,
  parseDialInfo,
  parseDialStatusCode,
  decodeDialStatus,
  formatDialUpgradeError,
  isFitProDialInfoPacket,
  isFitProDialStatusPacket,
  describeFitProDial,
  dialChunkSize,
  fitproByteSum,
  looksLikeFitProBadge,
  buildLegacyProbe,
  parseLegacyMac,
  parseLegacyName,
} from './fitpro.js';
import {
  PREVIEW,
  buildPreviewStart,
  buildPreviewEndResponse,
  buildPreviewStop,
  buildPreviewFrame,
  isPreviewStartResponse,
  isPreviewEndCommand,
  parsePreviewStartResponse,
} from './preview.js';
import {
  buildSyncTime,
  buildFindDevice,
  buildSetStepTarget,
  buildSetUserInfo,
  buildSetLanguage,
  buildDisturbSwitch,
  buildRealtimeStep,
  buildTakePhoto,
  buildDeviceControl,
  buildEnterOtaMode,
  buildShutdown,
  buildDeviceReset,
} from './commands.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One connected badge (GATT session + Baji / FitPro waiters).
 * Web Bluetooth allows several concurrent GATT connections; each needs its own
 * `requestDevice()` user gesture.
 */
class BadgeSession {
  constructor(hub) {
    this.hub = hub;
    this.id = null;
    this.ble = null;
    this.deviceInfo = null;
    this.disInfo = null;
    this.battery = null;
    /** Badge's own BD_ADDR, parsed from the legacy 0x1A/0x0A response. */
    this.deviceMac = null;
    /** Last free-space figure the badge reported for dial storage (bytes). */
    this.dialFreeBytes = null;
    this.mediaId = null;
    this.mediaList = null;
    /** @type {'unknown'|'baji'|'fitpro'} */
    this.protocolMode = 'unknown';
    this.dialInfo = null;
    this._fileId = 1n;
    this._waiters = new Map();
    this._transferring = false;
    /** Trace dial-module packets during a transfer (quiet mode hides them). */
    this._dialTrace = false;
    this._dialTraceCount = 0;
    /** Live viewfinder (product 0x27) state. */
    this.previewActive = false;
    this.previewDims = null;
    this._previewEnded = false;
    this._previewStartPending = false;
  }

  get connected() {
    return !!this.ble?.connected;
  }

  get name() {
    return this.ble?.device?.name || this.deviceInfo?.name || this.legacyName || null;
  }

  get requiresDialProfile() {
    return /^(BJ-1$|BG)/i.test(this.name || '');
  }

  /** True when Baji media/file modules are available. */
  get supportsBajiMedia() {
    return this.protocolMode === 'baji';
  }

  /** True when the session is doing heavy work (file transfer or live preview). */
  get busy() {
    return this._transferring || this.previewActive;
  }

  getSnapshot() {
    const dis = this.disInfo || {};
    const baji = this.deviceInfo || {};
    const dial = this.dialInfo || {};
    return {
      sessionId: this.id,
      connected: this.connected,
      name: this.name,
      model: dis.model || baji.name || dial.mchModel || null,
      firmware: dis.firmware || baji.deviceVersion || null,
      hardware: dis.hardware || null,
      software: dis.software || null,
      manufacturer: dis.manufacturer || null,
      serial: dis.serial || null,
      mac: this.deviceMac || null,
      dialFreeBytes: this.dialFreeBytes ?? null,
      protocol:
        baji.protocolVersion ||
        (this.protocolMode === 'fitpro' ? 'FitPro dial31' : this.protocolMode === 'baji' ? 'Baji' : null),
      protocolMode: this.protocolMode,
      battery: this.battery,
      freeStorage: baji.freeStorage ?? null,
      storageCapacity: baji.storageCapacity ?? null,
      maxFileSize: baji.maxFileSize ?? null,
      features: baji.features || null,
      mediaId: this.mediaId,
      dialWidth: dial.width ?? null,
      dialHeight: dial.height ?? null,
      dialAlgorithm: dial.algorithm ?? null,
      transferring: this._transferring,
      previewing: this.previewActive,
      previewWidth: this.previewDims?.width ?? null,
      previewHeight: this.previewDims?.height ?? null,
    };
  }

  summary() {
    const snap = this.getSnapshot();
    return {
      id: this.id,
      name: snap.name,
      model: snap.model,
      firmware: snap.firmware,
      battery: snap.battery,
      connected: snap.connected,
      active: this.hub.activeId === this.id,
      transferring: this._transferring,
    };
  }

  _emit(type, detail = {}) {
    this.hub._emit(type, { ...detail, sessionId: this.id });
  }

  _log(msg, level = 'info') {
    const tag = this.name || this.id || 'badge';
    this._emit('log', { msg: `[${tag}] ${msg}`, level, ts: Date.now() });
  }

  _waitFor(predicate, { timeoutMs = 15000, label = 'response', signal } = {}) {
    return new Promise((resolve, reject) => {
      const id = Symbol(label);
      const clear = () => {
        clearTimeout(timer);
        this._waiters.delete(id);
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        clear();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        clear();
        reject(new Error(`Timeout waiting for ${label}`));
      }, timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      this._waiters.set(id, {
        predicate,
        resolve: (pkt) => {
          clear();
          resolve(pkt);
        },
      });
    });
  }

  _onPacket(pkt) {
    this._emit('packet', { packet: pkt });

    // Device-initiated viewfinder: the badge opened its camera UI and asks the
    // phone to start streaming (no local PREVIEW_START pending).
    if (!this._previewStartPending && isPreviewStartResponse(pkt)) {
      const r = parsePreviewStartResponse(pkt.payload);
      if (r?.ok) {
        this.previewActive = true;
        this.previewDims = { width: r.width, height: r.height };
        this._log(`Badge opened its viewfinder — display ${r.width}×${r.height}`, 'ok');
        this._emit('preview', { phase: 'device-start', width: r.width, height: r.height });
        this.hub._emitSessions();
      } else {
        this._emit('preview', { phase: 'device-start-denied', status: r?.status ?? null });
      }
    }

    if (isPreviewEndCommand(pkt)) {
      this._previewEnded = true;
      this.previewActive = false;
      this._emit('preview', {
        phase: 'device-end',
        status: pkt.payload && pkt.payload.length ? pkt.payload[0] : null,
      });
    }

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

    // Legacy 0x1A responses: key 10 = device BD_ADDR, key 12 = name.
    if (pkt.moduleId === FitPro.LEGACY_MODULE || pkt.moduleKey === FitPro.LEGACY_MODULE) {
      if (pkt.commandId === 10) {
        const mac = parseLegacyMac(pkt.payload);
        if (mac && mac !== this.deviceMac) {
          this.deviceMac = mac;
          this._log(`Device MAC ${mac} (legacy 0x1A/0x0A)`, 'info');
          this.hub._emitSnapshot();
        }
      } else if (pkt.commandId === 12) {
        const legacyName = parseLegacyName(pkt.payload);
        if (legacyName) this.legacyName = legacyName;
      }
    }

    for (const [, w] of this._waiters) {
      if (w.predicate(pkt)) {
        w.resolve(pkt);
        break;
      }
    }

    // Dial-transfer trace: surface the badge's replies even though quiet mode
    // suppresses the normal per-packet logging.
    if (this._dialTrace && this._dialTraceCount < 32) {
      this._dialTraceCount++;
      const mod = (pkt.moduleId ?? 0).toString(16).padStart(2, '0');
      const cmd = (pkt.commandId ?? 0).toString(16);
      this._log(`dial ← module=0x${mod} cmd=0x${cmd} payload=${toHex(pkt.payload || new Uint8Array())}`, 'info');
    }
  }

  async connect({ acceptAll = false } = {}) {
    this.ble = new SuperBandBle({
      onLog: ({ msg, level }) => this._log(msg, level),
      onPacket: (pkt) => this._onPacket(pkt),
      onConnectionChange: (on, meta = {}) => {
        if (meta.id) this.id = meta.id;
        if (!on) {
          this.deviceInfo = null;
          this.disInfo = null;
          this.battery = null;
          this.deviceMac = null;
          this.dialFreeBytes = null;
          this.mediaId = null;
          this.mediaList = null;
          this.dialInfo = null;
          this.protocolMode = 'unknown';
          // Only drop the hub entry if this object still owns that id
          // (avoids wiping an existing session when a duplicate picker result is discarded).
          this.hub._onSessionLost(this.id, this);
          return;
        }
        this.hub._emitSessions();
        if (this.hub.activeId === this.id) {
          this.hub._emit('connection', {
            connected: this.hub.connected,
            name: this.hub.name,
            sessionId: this.id,
          });
          this.hub._emitSnapshot();
        }
      },
    });

    await this.ble.connect({ acceptAll });
    this.id = this.ble.device?.id || `session-${Date.now()}`;
    await this.refreshIdentity();
    return this;
  }

  async refreshIdentity() {
    this.battery = await this.ble.readBattery();
    if (this.battery != null) this._emit('battery', { level: this.battery });

    this.disInfo = await this.ble.readDeviceInformation();
    this._emit('disinfo', { info: this.disInfo });
    this.hub._emitSnapshot();

    // Read the panel dimensions and codec on BJ-1 and the BG series.
    if (looksLikeFitProBadge(this.name)) {
      this.protocolMode = 'fitpro';
      this._log('Protocol: FitPro dial31', 'ok');
      await this._fitProHandshake();
      if (this.requiresDialProfile && !this.dialInfo) {
        try {
          await this.refreshDialInfo({ timeoutMs: 4000 });
        } catch (error) {
          this._log(`Dial profile unavailable: ${error.message}`, 'warn');
        }
      }
      this.hub._emitSnapshot();
      return this.getSnapshot();
    }

    try {
      await this.refreshDeviceInfo({ timeoutMs: 6000 });
      this.protocolMode = 'baji';
      this._log('Protocol: Baji (media/file modules)', 'ok');
    } catch (e) {
      this.protocolMode = 'unknown';
      this._log(
        `Device protocol unrecognized (${e.message})`,
        'warn',
      );
    }
    this.hub._emitSnapshot();
    return this.getSnapshot();
  }

  /**
   * Android zl.java after DeviceFunctionEvent: D(10), D(12), capability D(28).
   * Best-effort — ignore failures; do not query dial info (crashes BJ-1).
   */
  async fitProHandshake() {
    if (!this.connected) return;
    const cmds = [
      [FitPro.LegacyCmd.PROBE_A, 'LEGACY_1A/10'],
      [FitPro.LegacyCmd.PROBE_B, 'LEGACY_1A/12'],
      [FitPro.LegacyCmd.CAPABILITY, 'LEGACY_1A/28'],
    ];
    for (const [cmd, label] of cmds) {
      if (!this.connected) break;
      try {
        await this.write(buildLegacyProbe(cmd), label);
        await sleep(120);
      } catch (e) {
        this._log(`${label} failed: ${e.message}`, 'warn');
        break;
      }
    }
  }

  /** @deprecated use fitProHandshake */
  async _fitProHandshake() {
    return this.fitProHandshake();
  }

  async disconnect() {
    await this.ble?.disconnect();
    this.ble = null;
  }

  async write(bytes, label, opts) {
    if (!this.connected) throw new Error('Not connected');
    return this.ble.write(bytes, label, opts);
  }

  async refreshDeviceInfo({ timeoutMs = 10000 } = {}) {
    const pkt = await this._request(
      buildDeviceInfoRequest(), 'DEVICE_INFO',
      (p) => p.dialect === 'baji' && p.moduleId === Module.SYSTEM && p.commandId === SysCmd.DEVICE_INFO_RESPONSE,
      timeoutMs,
    );
    const info = parseDeviceInfo(pkt.payload);
    if (!info) throw new Error('Malformed Baji device information');
    this.deviceInfo = info;
    this._emit('deviceinfo', { info });
    this.hub._emitSnapshot();
    return info;
  }

  async pair() {
    await this.write(buildPairingFrame(), 'legacy pair');
  }

  async allocateMediaId({ timeoutMs = 30000 } = {}) {
    if (!this.supportsBajiMedia) {
      throw new Error('Media ID is Baji-only; this badge uses FitPro dial push');
    }
    await this.write(buildMediaIdRequest(), 'MEDIA_ID_REQUEST');
    const pkt = await this._waitFor(
      (p) => p.moduleId === Module.MEDIA && p.commandId === MediaCmd.ID_RESPONSE,
      { timeoutMs, label: 'MEDIA_ID_RESPONSE' },
    );
    const r = parseMediaIdResponse(pkt.payload);
    if (!r?.success) throw new Error(r?.message || 'Media ID allocation failed');
    this.mediaId = Number(r.mediaId);
    this._emit('mediaid', { mediaId: this.mediaId, message: r.message });
    this.hub._emitSnapshot();
    return this.mediaId;
  }

  async requestMediaList({ timeoutMs = 15000 } = {}) {
    if (!this.supportsBajiMedia) {
      this._log('Skip MEDIA_LIST — FitPro badge (Baji media disconnects BJ-1)', 'warn');
      return [];
    }
    await this.write(buildMediaListRequest(), 'MEDIA_LIST_REQUEST');
    const pkt = await this._waitFor(
      (p) => p.moduleId === Module.MEDIA && p.commandId === MediaCmd.LIST_RESPONSE,
      { timeoutMs, label: 'MEDIA_LIST_RESPONSE' },
    );
    const items = parseMediaList(pkt.payload);
    this.mediaList = items;
    this._emit('medialist', { items, raw: pkt.payload });
    return items;
  }

  async deleteMedia(mediaId, { timeoutMs = 15000 } = {}) {
    if (!this.supportsBajiMedia) {
      throw new Error('Media delete is Baji-only on this badge');
    }
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

  async refreshDialInfo({ timeoutMs = 8000 } = {}) {
    if (this.busy) throw new Error('Wait for the badge to finish its current operation');
    const pkt = await this._request(buildDialInfoRequest(), 'DIAL_INFO', isFitProDialInfoPacket, timeoutMs);
    const info = parseDialInfo(pkt.payload);
    if (!info) throw new Error('Could not parse dial info');
    this.dialInfo = info;
    if (this.protocolMode === 'unknown') this.protocolMode = 'fitpro';
    this._log(`Dial info: ${describeFitProDial(info)}`, 'ok');
    this._emit('dialinfo', { info });
    this.hub._emitSnapshot();
    return info;
  }

  async _request(frame, label, predicate, timeoutMs) {
    const controller = new AbortController();
    try {
      const [pkt] = await Promise.all([
        this._waitFor(predicate, { timeoutMs, label: `${label} response`, signal: controller.signal }),
        this.write(frame, label),
      ]);
      return pkt;
    } finally {
      controller.abort();
    }
  }

  // Register before writing: a notification can arrive during the GATT write or its pacing delay.
  async _writeDialAndWait(frame, label, expectedCode, writeOpts) {
    const controller = new AbortController();
    const ack = this._waitFor((pkt) => {
      if (!isFitProDialStatusPacket(pkt)) return false;
      const code = parseDialStatusCode(pkt.payload);
      const { kind } = decodeDialStatus(code);
      return code === expectedCode || kind === 'error' || kind === 'memory' || code === FitPro.STATUS_OK;
    }, {
      timeoutMs: FitPro.ACK_TIMEOUT_MS,
      label: `${label} status ${expectedCode}`,
      signal: controller.signal,
    });
    const poll = setInterval(() => {
      if (!this.connected) {
        controller.abort(new Error('Disconnected while waiting for dial status'));
        return;
      }
      this.write(buildDialStatusRequest(), 'DIAL_STATUS_POLL', writeOpts).catch(() => {});
    }, FitPro.ACK_TICK_MS);

    try {
      const [pkt] = await Promise.all([ack, this.write(frame, label, writeOpts)]);
      const code = parseDialStatusCode(pkt.payload);
      if (code === expectedCode) return;
      const status = decodeDialStatus(code);
      if (status.kind === 'memory') {
        throw new Error(`Badge refused the dial for lack of space (status 1010, value ${status.freeBytes}). Query free space for the available bytes.`);
      }
      throw new Error(formatDialUpgradeError(code));
    } finally {
      clearInterval(poll);
      controller.abort();
    }
  }

  async queryTransferStatus() {
    await this.write(buildStatusQuery(), 'STATUS');
  }

  /**
   * Ask the badge how much dial storage is free (module 0x20 / key 4).
   * @returns {Promise<{bytes:number|null, raw:string}>}
   */
  async dialRemainSpace({ timeoutMs = 4000 } = {}) {
    if (!this.connected) throw new Error('Not connected');
    if (this.protocolMode !== 'fitpro') throw new Error('Dial free space is available on FitPro badges');
    if (this.busy) throw new Error('Wait for the badge to finish its current operation');
    const pkt = await this._request(
      buildDialRemainSpaceRequest(), 'DIAL_REMAIN_SPACE',
      (p) => p.dialect === 'fitpro' && p.moduleId === FitPro.DIAL_INFO_MODULE && p.commandId === 4,
      timeoutMs,
    );
    const raw = toHex(pkt.payload || new Uint8Array());
    const bytes = parseDialRemainSpace(pkt.payload);
    this.dialFreeBytes = bytes;
    this._log(`Dial free space ← ${raw} → ${bytes == null ? '?' : bytes} bytes`, 'info');
    this.hub._emitSnapshot();
    return { bytes, raw };
  }

  async transferFile(
    fileBytes,
    {
      fileType = FileType.IMAGE,
      functionType = FunctionType.BACKGROUND,
      mediaId = null,
      allocateId = true,
      onProgress = null,
      /**
       * FitPro dial payload type override: 0 = RGB565, 1 = AVI video, 2 = JPEG.
       * Left null → derived from the dial info (images). Video push passes 1.
       */
      dialType = null,
    } = {},
  ) {
    if (this.protocolMode === 'unknown') throw new Error('Identify the badge protocol before uploading');
    if (this.previewActive) throw new Error('Live preview is running — stop it before pushing');
    if (this.protocolMode !== 'baji') {
      return this.transferDialFile(fileBytes, { onProgress, dialType });
    }

    if (this._transferring) throw new Error('Transfer already in progress on this badge');
    this._transferring = true;
    this.hub._emitSessions();

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
      return { fileId, mediaId: mid, checksum, verified, sessionId: this.id, path: 'baji' };
    } finally {
      this._transferring = false;
      this.hub._emitSessions();
    }
  }

  /**
   * FitPro WatchTheme3 dial31 custom-background upload.
   * Android `gh3` pacing/ACKs; chunk size capped so each CD frame is one GATT write
   * (Web Bluetooth cannot safely stream mid-frame ATT fragments the way the Android stack does).
   */
  async transferDialFile(fileBytes, { onProgress = null, dialType = null } = {}) {
    if (this._transferring) throw new Error('Transfer already in progress on this badge');
    if (this.previewActive) throw new Error('Live preview is running — stop it before pushing');
    if (!this.connected) throw new Error('Not connected');
    this._transferring = true;
    this.hub._emitSessions();
    const writeOpts = { paceMs: FitPro.COMMAND_POOL_MS, quiet: true, atomic: true };
    this.ble?.setQuiet?.(true);

    try {
      const info = this.dialInfo;
      const isVideo = dialType === 1;
      if (this.requiresDialProfile && !info) {
        throw new Error('Dial profile unavailable. Read dial info in Advanced before pushing.');
      }
      const expectJpeg = info?.algorithm === 4;
      const resolvedType = isVideo ? 1 : expectJpeg ? 2 : 0;
      const format = isVideo ? 'MJPG AVI' : expectJpeg ? 'JPEG 4:4:4'
        : info?.algorithm === 3 ? 'BR35 ETC2' : 'packed JieLi RGB565';
      if (isVideo) {
        if (!isMjpgAvi(fileBytes)) throw new Error('Prepare a valid MJPG AVI for this badge');
      } else {
        const image = expectJpeg ? describeJpeg(fileBytes) : inspectJieliResource(fileBytes, info?.algorithm);
        if (expectJpeg ? !image.ok : !image) {
          throw new Error(`Prepare a valid ${format} image for this badge`);
        }
        if (info && (image.width !== info.width || image.height !== info.height)) {
          throw new Error(`This badge requires a ${info.width}×${info.height} image`);
        }
      }

      const fileBlob = buildDialFileBlob(fileBytes);
      const attMax = this.ble?.maxWriteLength || 512;
      const chunkSize = dialChunkSize(info, attMax);
      const checksum = fitproByteSum(fileBlob);
      const totalChunks = Math.max(1, Math.ceil(fileBlob.length / chunkSize));
      if (totalChunks > 0xffff) throw new Error('The file exceeds the dial transfer packet limit');

      this._log(
        `Dial31 size=${fileBlob.length} ${isVideo ? 'avi' : 'img'}=${fileBytes.length} ` +
          `chunk=${chunkSize} (atomic GATT, attMax=${attMax}) chunks=${totalChunks} ` +
          `type=${resolvedType} ${format} pace=${FitPro.COMMAND_POOL_MS}ms`,
        'info',
      );
      this._emit('transfer', {
        phase: 'start',
        mediaId: FitPro.PICTURE_DIAL_ID,
        size: fileBlob.length,
        checksum,
        path: 'fitpro-dial31',
      });
      onProgress?.(2);

      if (this.connected) await this._fitProHandshake();
      await sleep(200);

      const startPayload = buildDialStartPayload({
        dialId: FitPro.PICTURE_DIAL_ID,
        dialType: resolvedType,
        fileSize: fileBlob.length,
      });
      this._dialTrace = true;
      this._dialTraceCount = 0;
      try {
        await this._writeDialAndWait(
          buildDialStart(startPayload), 'DIAL_START', FitPro.STATUS_CHUNK_BASE, writeOpts,
        );
      } finally {
        this._dialTrace = false;
      }
      onProgress?.(5);

      for (let i = 0; i < totalChunks; i++) {
        if (!this.connected) throw new Error('Disconnected during dial upload');
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileBlob.length);
        const slice = fileBlob.subarray
          ? fileBlob.subarray(start, end)
          : fileBlob.slice(start, end);
        const seq = i + 1;
        await this._writeDialAndWait(
          buildDialDataChunk(seq, slice), `DIAL_DATA[${seq}]`, FitPro.STATUS_CHUNK_BASE + seq, writeOpts,
        );
        const pct = 5 + Math.round(((i + 1) / totalChunks) * 90);
        onProgress?.(pct, i + 1, totalChunks);
        this._emit('transfer', { phase: 'chunk', index: i, total: totalChunks, percent: pct });
      }

      await this._writeDialAndWait(buildDialFinish(fileBlob), 'DIAL_FINISH', FitPro.STATUS_OK, writeOpts);
      onProgress?.(100, totalChunks, totalChunks);
      this._emit('transfer', {
        phase: 'complete',
        mediaId: FitPro.PICTURE_DIAL_ID,
        checksum,
        verified: true,
        path: 'fitpro-dial31',
      });
      this._log(
        `Dial31 complete ${fileBlob.length}B in ${totalChunks} logical chunks (checksum=${checksum})`,
        'ok',
      );
      return {
        fileId: FitPro.PICTURE_DIAL_ID,
        mediaId: FitPro.PICTURE_DIAL_ID,
        checksum,
        verified: true,
        sessionId: this.id,
        path: 'fitpro-dial31',
      };
    } finally {
      this.ble?.setQuiet?.(false);
      this._transferring = false;
      this.hub._emitSessions();
    }
  }

  // ── Live viewfinder (product 0x27) ────────────────────────────────────────

  /**
   * Send the preview START frame and wait for the device start response.
   * @returns {Promise<{width:number,height:number}>} device display size
   */
  async previewStart({ timeoutMs = 5000 } = {}) {
    if (!this.connected) throw new Error('Not connected');
    if (this.protocolMode !== 'fitpro') throw new Error('Live preview requires a FitPro badge');
    if (this.previewActive || this._previewStartPending) throw new Error('Preview already running');
    if (this._transferring) throw new Error('A file transfer is in progress');
    this._previewEnded = false;
    this._previewStartPending = true;
    try {
      const pkt = await this._request(buildPreviewStart(), 'PREVIEW_START', isPreviewStartResponse, timeoutMs);
      const r = parsePreviewStartResponse(pkt.payload);
      if (!r) throw new Error('Malformed preview start response');
      if (!r.ok) throw new Error(`Device rejected preview (status ${r.status})`);
      this.previewActive = true;
      this.previewDims = { width: r.width, height: r.height };
      this._log(`Preview started — device display ${r.width}×${r.height}`, 'ok');
      this._emit('preview', { phase: 'started', width: r.width, height: r.height });
      this.hub._emitSessions();
      return this.previewDims;
    } finally {
      this._previewStartPending = false;
    }
  }

  /** Push one JPEG frame to the badge display (chunked raw 0xAA…0xAA frame). */
  async previewSendFrame(jpeg, { chunkSize = PREVIEW.DEFAULT_CHUNK, paceMs = 4 } = {}) {
    if (!this.connected) throw new Error('Not connected');
    if (!this.previewActive) throw new Error('Preview not started');
    const frame = buildPreviewFrame(jpeg);
    await this.write(frame, `PREVIEW_FRAME(${jpeg.length}B)`, {
      atomic: false,
      chunkSize,
      paceMs,
      quiet: true,
    });
    this._emit('preview', { phase: 'frame', bytes: jpeg.length });
    return frame.length;
  }

  /** Reply to a device-initiated end command (status 0 = success). */
  async previewRespondEnd(status = PREVIEW.STATUS_SUCCESS) {
    if (!this.connected) return;
    await this.write(buildPreviewEndResponse(status), 'PREVIEW_END_RESPONSE', { quiet: true });
  }

  /** Stop the preview stream (optionally sending an end response first). */
  async previewStop({ respond = false, status = PREVIEW.STATUS_SUCCESS } = {}) {
    const wasActive = this.previewActive;
    this.previewActive = false;
    if (!this.connected) return;
    if (respond) await this.previewRespondEnd(status);
    await this.write(buildPreviewStop(), 'PREVIEW_STOP', { quiet: true });
    if (wasActive) {
      this._log('Preview stopped', 'info');
      this._emit('preview', { phase: 'stopped' });
      this.hub._emitSessions();
    }
  }

  // ── Quick settings / device control (legacy MyWatch frames) ───────────────

  async syncTime(date = new Date()) {
    await this.write(buildSyncTime(date), 'SYNC_TIME');
  }

  async findDevice(on = true) {
    await this.write(buildFindDevice(on), on ? 'FIND_DEVICE_ON' : 'FIND_DEVICE_OFF');
  }

  async setStepTarget(steps) {
    await this.write(buildSetStepTarget(steps), 'SET_STEP_TARGET');
  }

  async setUserInfo(info) {
    await this.write(buildSetUserInfo(info), 'SET_USER_INFO');
  }

  async setLanguage(index) {
    await this.write(buildSetLanguage(index), 'SET_LANGUAGE');
  }

  async setDisturb(on, startHour, endHour) {
    await this.write(buildDisturbSwitch(on, startHour, endHour), 'SET_DISTURB');
  }

  async setRealtimeStep(on) {
    await this.write(buildRealtimeStep(on), 'REALTIME_STEP');
  }

  async takePhoto(on = true) {
    await this.write(buildTakePhoto(on), on ? 'TAKE_PHOTO_ON' : 'TAKE_PHOTO_OFF');
  }

  async deviceControl(key, value = null) {
    await this.write(buildDeviceControl(key, value), `DEV_CTRL_${key}`);
  }

  async enterOtaMode() {
    await this.write(buildEnterOtaMode(), 'ENTER_OTA_MODE');
  }

  async shutdown() {
    await this.write(buildShutdown(), 'SHUTDOWN');
  }

  async deviceReset() {
    await this.write(buildDeviceReset(), 'DEVICE_RESET');
  }

  async stopTransfer() {
    if (this.protocolMode === 'baji') {
      await this.write(buildTransferStop(this._fileId), 'TRANSFER_STOP');
    }
  }
}

/**
 * Multi-badge hub. Each `connect()` opens another Web Bluetooth picker and keeps
 * prior sessions alive. Commands target the active session unless noted.
 */
export class SuperBandClient extends EventTarget {
  constructor() {
    super();
    /** @type {Map<string, BadgeSession>} */
    this._sessions = new Map();
    this.activeId = null;
  }

  static supported() {
    return SuperBandBle.supported();
  }

  get sessionCount() {
    return this._sessions.size;
  }

  get connected() {
    return !!this.active?.connected;
  }

  get name() {
    return this.active?.name || null;
  }

  get active() {
    return this.activeId ? this._sessions.get(this.activeId) || null : null;
  }

  get sessions() {
    return [...this._sessions.values()].map((s) => s.summary());
  }

  getSnapshot() {
    return this.active?.getSnapshot() || {
      connected: false,
      name: null,
      model: null,
      firmware: null,
      hardware: null,
      software: null,
      manufacturer: null,
      serial: null,
      protocol: null,
      protocolMode: 'unknown',
      battery: null,
      freeStorage: null,
      storageCapacity: null,
      maxFileSize: null,
      features: null,
      mediaId: null,
      dialWidth: null,
      dialHeight: null,
      dialAlgorithm: null,
      sessionId: null,
      previewing: false,
      previewWidth: null,
      previewHeight: null,
    };
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _emitSnapshot() {
    this._emit('snapshot', { snapshot: this.getSnapshot(), sessionId: this.activeId });
  }

  _emitSessions() {
    this._emit('sessions', {
      sessions: this.sessions,
      activeId: this.activeId,
      count: this.sessionCount,
    });
  }

  _requireActive() {
    const s = this.active;
    if (!s?.connected) throw new Error('No active badge connected');
    return s;
  }

  _onSessionLost(id, session) {
    if (!id) return;
    const cur = this._sessions.get(id);
    if (!cur || (session && cur !== session)) return;
    this._sessions.delete(id);
    if (this.activeId === id) {
      const next = this._sessions.keys().next();
      this.activeId = next.done ? null : next.value;
    }
    this._emitSessions();
    this._emit('connection', {
      connected: this.connected,
      name: this.name,
      sessionId: this.activeId,
    });
    this._emitSnapshot();
  }

  setActive(id) {
    if (!this._sessions.has(id)) throw new Error('Unknown session');
    this.activeId = id;
    this._emitSessions();
    this._emit('connection', {
      connected: this.connected,
      name: this.name,
      sessionId: this.activeId,
    });
    this._emitSnapshot();
    const s = this.active;
    if (s?.mediaList) {
      this._emit('medialist', { items: s.mediaList, sessionId: s.id });
    }
    return s;
  }

  /**
   * Open the Bluetooth picker and add another badge (keeps existing connections).
   * Selecting an already-connected device focuses that session.
   */
  async connect({ acceptAll = false } = {}) {
    const session = new BadgeSession(this);
    await session.connect({ acceptAll });

    const existing = this._sessions.get(session.id);
    if (existing && existing !== session) {
      // Same BluetoothDevice id already connected — do not GATT-disconnect
      // (that would drop the live session sharing this device object).
      this._logReuse(session);
      session.ble?.abandon();
      session.ble = null;
      this.setActive(existing.id);
      return existing;
    }

    if (!session.connected) {
      session.ble?.abandon?.();
      throw new Error(
        `${session.name || 'Badge'} dropped during identity probe — reconnect and retry`,
      );
    }

    this._sessions.set(session.id, session);
    this.activeId = session.id;
    this._emitSessions();
    this._emit('connection', {
      connected: true,
      name: session.name,
      sessionId: session.id,
    });
    this._emitSnapshot();
    this._emit('log', {
      msg: `Session ready: ${session.name || session.id} (${this.sessionCount} connected)`,
      level: 'ok',
      ts: Date.now(),
    });
    return session;
  }

  _logReuse(session) {
    this._emit('log', {
      msg: `${session.name || session.id} already connected — switched to existing session`,
      level: 'info',
      ts: Date.now(),
    });
  }

  async disconnect(id = this.activeId) {
    if (!id) return;
    const s = this._sessions.get(id);
    if (!s) return;
    await s.disconnect();
    this._sessions.delete(id);
    if (this.activeId === id) {
      const next = this._sessions.keys().next();
      this.activeId = next.done ? null : next.value;
    }
    this._emitSessions();
    this._emit('connection', {
      connected: this.connected,
      name: this.name,
      sessionId: this.activeId,
    });
    this._emitSnapshot();
  }

  async disconnectAll() {
    const ids = [...this._sessions.keys()];
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  async refreshIdentity() {
    return this._requireActive().refreshIdentity();
  }

  async refreshDeviceInfo(opts) {
    return this._requireActive().refreshDeviceInfo(opts);
  }

  async refreshDialInfo(opts) {
    return this._requireActive().refreshDialInfo(opts);
  }

  async fitProHandshake() {
    return this._requireActive().fitProHandshake();
  }

  /** Active session GATT server (for AE00 probe / OTA). */
  getActiveGattServer() {
    const server = this.active?.ble?.gattServer;
    return server?.connected ? server : null;
  }

  async pair() {
    return this._requireActive().pair();
  }

  async write(bytes, label, opts) {
    return this._requireActive().write(bytes, label, opts);
  }

  async allocateMediaId(opts) {
    return this._requireActive().allocateMediaId(opts);
  }

  async requestMediaList(opts) {
    return this._requireActive().requestMediaList(opts);
  }

  async deleteMedia(mediaId, opts) {
    return this._requireActive().deleteMedia(mediaId, opts);
  }

  async queryTransferStatus() {
    return this._requireActive().queryTransferStatus();
  }

  async dialRemainSpace(opts) {
    return this._requireActive().dialRemainSpace(opts);
  }

  async transferFile(fileBytes, opts) {
    return this._requireActive().transferFile(fileBytes, opts);
  }

  /** True if any connected session is mid-transfer. */
  get anyTransferring() {
    for (const session of this._sessions.values()) {
      if (session.connected && session._transferring) return true;
    }
    return false;
  }

  /**
   * Push the same image to every connected badge in parallel (one GATT write stream each).
   * @param {Uint8Array | ((snapshot: object) => Promise<Uint8Array>)} image
   * @param {{ onProgress?: (pct: number, detail?: object) => void } & object} opts
   */
  async transferFileToAll(image, opts = {}) {
    const { onProgress = null, ...rest } = opts;
    const targets = [...this._sessions.values()].filter((s) => s.connected);
    if (!targets.length) return [];

    const pctById = new Map(targets.map((s) => [s.id, 0]));
    const emitAgg = () => {
      if (!onProgress) return;
      let sum = 0;
      for (const p of pctById.values()) sum += p;
      const overall = Math.round(sum / targets.length);
      const perBadge = targets.map((s) => ({
        sessionId: s.id,
        name: s.name,
        percent: pctById.get(s.id) ?? 0,
      }));
      onProgress(overall, { perBadge });
    };

    this._emitSessions();
    const settled = await Promise.allSettled(
      targets.map(async (session) => {
        const bytes = typeof image === 'function' ? await image(session.getSnapshot()) : image;
        return session.transferFile(bytes, {
          ...rest,
          onProgress: (pct) => {
            pctById.set(session.id, Number(pct) || 0);
            emitAgg();
          },
        });
      }),
    );

    const results = settled.map((outcome, i) => {
      const session = targets[i];
      if (outcome.status === 'fulfilled') {
        return { ok: true, ...outcome.value, name: session.name };
      }
      return {
        ok: false,
        error: outcome.reason?.message || String(outcome.reason),
        sessionId: session.id,
        name: session.name,
      };
    });

    this._emitSessions();
    this._emitSnapshot();
    return results;
  }

  // ── Live viewfinder + quick commands (active session) ─────────────────────

  get previewActive() {
    return !!this.active?.previewActive;
  }

  get anyPreviewing() {
    for (const session of this._sessions.values()) {
      if (session.connected && session.previewActive) return true;
    }
    return false;
  }

  async previewStart(opts) {
    return this._requireActive().previewStart(opts);
  }

  async previewSendFrame(jpeg, opts) {
    return this._requireActive().previewSendFrame(jpeg, opts);
  }

  async previewRespondEnd(status) {
    return this._requireActive().previewRespondEnd(status);
  }

  async previewStop(opts) {
    return this._requireActive().previewStop(opts);
  }

  async syncTime(date) {
    return this._requireActive().syncTime(date);
  }

  async findDevice(on) {
    return this._requireActive().findDevice(on);
  }

  async setStepTarget(steps) {
    return this._requireActive().setStepTarget(steps);
  }

  async setUserInfo(info) {
    return this._requireActive().setUserInfo(info);
  }

  async setLanguage(index) {
    return this._requireActive().setLanguage(index);
  }

  async setDisturb(on, startHour, endHour) {
    return this._requireActive().setDisturb(on, startHour, endHour);
  }

  async setRealtimeStep(on) {
    return this._requireActive().setRealtimeStep(on);
  }

  async takePhoto(on) {
    return this._requireActive().takePhoto(on);
  }

  async deviceControl(key, value) {
    return this._requireActive().deviceControl(key, value);
  }

  async enterOtaMode() {
    return this._requireActive().enterOtaMode();
  }

  async shutdown() {
    return this._requireActive().shutdown();
  }

  async deviceReset() {
    return this._requireActive().deviceReset();
  }

  async stopTransfer() {
    return this._requireActive().stopTransfer();
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
