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
import {
  FitPro,
  buildDialInfoRequest,
  buildDialStatusRequest,
  buildDialStart,
  buildDialStartPayload,
  buildDialDataChunk,
  buildDialFinish,
  buildDialFileBlob,
  parseDialInfo,
  parseDialStatusCode,
  formatDialUpgradeError,
  isFitProDialInfoPacket,
  isFitProDialStatusPacket,
  describeFitProDial,
  dialChunkSize,
  fitproByteSum,
  looksLikeFitProBadge,
  buildLegacyProbe,
} from './fitpro.js';

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
    this.mediaId = null;
    this.mediaList = null;
    /** @type {'unknown'|'baji'|'fitpro'} */
    this.protocolMode = 'unknown';
    this.dialInfo = null;
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

  /** True when Baji media/file modules are available. */
  get supportsBajiMedia() {
    return this.protocolMode === 'baji';
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
      onConnectionChange: (on, meta = {}) => {
        if (meta.id) this.id = meta.id;
        if (!on) {
          this.deviceInfo = null;
          this.disInfo = null;
          this.battery = null;
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

    // BJ-1 / DG01: Baji DEVICE_INFO times out; DIAL_INFO (0x20) often drops GATT.
    // Match the Android post-connect path: legacy 0x1A probes, then FitPro dial31 for push.
    if (looksLikeFitProBadge(this.name)) {
      this.protocolMode = 'fitpro';
      this._log('Protocol: FitPro dial31 (GAP name heuristic — skipping Baji / dial-info probes)', 'ok');
      await this._fitProHandshake();
      this.hub._emitSnapshot();
      return this.getSnapshot();
    }

    try {
      await this.refreshDeviceInfo({ timeoutMs: 6000 });
      this.protocolMode = 'baji';
      this._log('Protocol: Baji (media/file modules)', 'ok');
    } catch (e) {
      this.protocolMode = 'fitpro';
      this._log(
        `Baji device info unavailable (${e.message}) — FitPro dial path (no dial-info probe)`,
        'warn',
      );
      if (this.connected) await this._fitProHandshake();
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
    await this.write(buildDialInfoRequest(), 'DIAL_INFO_REQUEST');
    const pkt = await this._waitFor((p) => isFitProDialInfoPacket(p), {
      timeoutMs,
      label: 'DIAL_INFO_RESPONSE',
    });
    const info = parseDialInfo(pkt.payload);
    if (!info) throw new Error('Could not parse dial info');
    this.dialInfo = info;
    this._log(`Dial info: ${describeFitProDial(info)}`, 'ok');
    this._emit('dialinfo', { info });
    this.hub._emitSnapshot();
    return info;
  }

  /**
   * Wait for dial status. Default: listen only (no 0x20 polls — those disconnect BJ-1).
   * Set poll=true to mirror WatchTheme3Tools.L() on devices that tolerate it.
   */
  async _waitDialStatus(
    expectedCode,
    { timeoutMs = 15000, label = 'DIAL_STATUS', poll = false } = {},
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.connected) throw new Error('Disconnected while waiting for dial status');
      const remain = Math.max(200, deadline - Date.now());
      const pending = this._waitFor(
        (p) => isFitProDialStatusPacket(p) && parseDialStatusCode(p.payload) != null,
        { timeoutMs: Math.min(poll ? 2500 : remain, remain), label },
      );
      if (poll) {
        this.write(buildDialStatusRequest(), 'DIAL_STATUS_POLL').catch(() => {});
      }
      try {
        const pkt = await pending;
        const code = parseDialStatusCode(pkt.payload);
        if (code === expectedCode) return pkt;
        if (code >= 1 && code <= 9) {
          throw new Error(formatDialUpgradeError(code));
        }
      } catch (e) {
        if (String(e.message || '').startsWith('Dial upgrade error')) throw e;
        if (String(e.message || '').includes('Disconnected')) throw e;
        if (!poll) break;
      }
    }
    throw new Error(`Timeout waiting for ${label} (code ${expectedCode})`);
  }

  /** Soft wait: success on status, else continue after timeout (paced upload). */
  async _awaitDialStatusOrContinue(expectedCode, { timeoutMs = 800, label = 'DIAL_STATUS' } = {}) {
    try {
      await this._waitDialStatus(expectedCode, { timeoutMs, label, poll: false });
      return true;
    } catch (e) {
      if (String(e.message || '').startsWith('Dial upgrade error')) throw e;
      if (!this.connected) throw e;
      return false;
    }
  }

  async queryTransferStatus() {
    await this.write(buildStatusQuery(), 'STATUS');
  }

  async transferFile(
    fileBytes,
    {
      fileType = FileType.IMAGE,
      functionType = FunctionType.BACKGROUND,
      mediaId = null,
      allocateId = true,
      onProgress = null,
    } = {},
  ) {
    if (this.protocolMode !== 'baji') {
      return this.transferDialFile(fileBytes, { onProgress });
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
   * FitPro WatchTheme3 dial31 custom-background upload (BJ-1 / LJ733 SuperBand).
   */
  async transferDialFile(fileBytes, { onProgress = null } = {}) {
    if (this._transferring) throw new Error('Transfer already in progress on this badge');
    if (!this.connected) throw new Error('Not connected');
    this._transferring = true;
    this.hub._emitSessions();

    try {
      // Do not send DIAL_INFO (0x20) — drops BJ-1. Default RGB565 + dialType 0
      // (AC707N / dg01-ble). JPEG type 2 only when dial-info reported algorithm 4.
      const info = this.dialInfo;
      const dialType = info?.dialType ?? (info?.algorithm === 4 ? 2 : 0);
      const expectJpeg = dialType === 2;
      const looksJpeg =
        fileBytes.length >= 3 && fileBytes[0] === 0xff && fileBytes[1] === 0xd8;
      if (expectJpeg && !looksJpeg) {
        throw new Error('Dial algorithm 4 expects JPEG 4:4:4 bytes; re-prepare image');
      }
      if (!expectJpeg && looksJpeg) {
        throw new Error(
          'FitPro badge expects RGB565 (dial type 0), not JPEG — re-select the image after connect',
        );
      }
      const fileBlob = buildDialFileBlob(fileBytes);
      const chunkSize = dialChunkSize(info);
      const checksum = fitproByteSum(fileBlob);

      this._log(
        `Dial31 push size=${fileBlob.length} (img=${fileBytes.length}) chunk=${chunkSize} type=${dialType} ${expectJpeg ? 'JPEG' : 'RGB565'} (no dial-info probe)`,
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
        dialType,
        fileSize: fileBlob.length,
      });
      await this.write(buildDialStart(startPayload), 'DIAL_START');
      // Prefer spontaneous status; fall back to paced send (no 0x20 polls).
      const startAck = await this._awaitDialStatusOrContinue(FitPro.STATUS_CHUNK_BASE, {
        timeoutMs: 1500,
        label: 'DIAL_START_ACK(1000)',
      });
      if (!startAck) this._log('No start ACK — continuing paced dial upload', 'warn');
      onProgress?.(5);

      const totalChunks = Math.max(1, Math.ceil(fileBlob.length / chunkSize));
      for (let i = 0; i < totalChunks; i++) {
        if (!this.connected) throw new Error('Disconnected during dial upload');
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileBlob.length);
        const slice = fileBlob.slice(start, end);
        const seq = i + 1;
        await this.write(buildDialDataChunk(seq, slice), `DIAL_DATA[${seq}]`);
        await this._awaitDialStatusOrContinue(FitPro.STATUS_CHUNK_BASE + seq, {
          timeoutMs: 400,
          label: `DIAL_CHUNK_ACK(${FitPro.STATUS_CHUNK_BASE + seq})`,
        });
        await sleep(12);
        const pct = 5 + Math.round(((i + 1) / totalChunks) * 90);
        onProgress?.(pct, i + 1, totalChunks);
        this._emit('transfer', { phase: 'chunk', index: i, total: totalChunks, percent: pct });
      }

      await this.write(buildDialFinish(fileBlob), 'DIAL_FINISH');
      const finished = await this._awaitDialStatusOrContinue(FitPro.STATUS_OK, {
        timeoutMs: 5000,
        label: 'DIAL_FINISH_OK(2)',
      });
      onProgress?.(100, totalChunks, totalChunks);
      this._emit('transfer', {
        phase: 'complete',
        mediaId: FitPro.PICTURE_DIAL_ID,
        checksum,
        verified: finished,
        path: 'fitpro-dial31',
      });
      return {
        fileId: FitPro.PICTURE_DIAL_ID,
        mediaId: FitPro.PICTURE_DIAL_ID,
        checksum,
        verified: finished,
        sessionId: this.id,
        path: 'fitpro-dial31',
      };
    } finally {
      this._transferring = false;
      this.hub._emitSessions();
    }
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

  async write(bytes, label) {
    return this._requireActive().write(bytes, label);
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

  async transferFile(fileBytes, opts) {
    return this._requireActive().transferFile(fileBytes, opts);
  }

  /**
   * Push the same image to every connected badge (sequential).
   */
  async transferFileToAll(fileBytes, opts = {}) {
    const results = [];
    for (const session of this._sessions.values()) {
      if (!session.connected) continue;
      const prev = this.activeId;
      this.activeId = session.id;
      this._emitSessions();
      try {
        const r = await session.transferFile(fileBytes, opts);
        results.push({ ok: true, ...r, name: session.name });
      } catch (e) {
        results.push({ ok: false, error: e.message, sessionId: session.id, name: session.name });
      } finally {
        this.activeId = prev;
      }
    }
    this._emitSessions();
    this._emitSnapshot();
    return results;
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
