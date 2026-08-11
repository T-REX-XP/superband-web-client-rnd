import { SuperBandBle } from './ble.js';
import {
  Module,
  FileCmd,
  MediaCmd,
  SysCmd,
  FileType,
  FunctionType,
  PROTOCOL,
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
  buildPacket,
  buildPairingFrame,
  crc32,
  fromHex,
  toHex,
  parseDeviceInfo,
  parseMediaIdResponse,
  parseAck,
  parseNack,
} from './protocol.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  ble: null,
  mediaId: null,
  fileId: 1n,
  transferring: false,
  waiters: new Map(),
};

function setStatus(text, kind = '') {
  const el = $('#connStatus');
  el.textContent = text;
  el.dataset.kind = kind;
}

function logLine({ msg, level }) {
  const consoleEl = $('#console');
  const row = document.createElement('div');
  row.className = `log log-${level || 'info'}`;
  const time = new Date().toLocaleTimeString();
  row.innerHTML = `<span class="log-time">${time}</span><span class="log-msg"></span>`;
  row.querySelector('.log-msg').textContent = msg;
  consoleEl.appendChild(row);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function waitFor(predicate, { timeoutMs = 15000, label = 'response' } = {}) {
  return new Promise((resolve, reject) => {
    const id = Symbol(label);
    const timer = setTimeout(() => {
      state.waiters.delete(id);
      reject(new Error(`Timeout waiting for ${label}`));
    }, timeoutMs);
    state.waiters.set(id, {
      predicate,
      resolve: (pkt) => {
        clearTimeout(timer);
        state.waiters.delete(id);
        resolve(pkt);
      },
    });
  });
}

function dispatchPacket(pkt) {
  if (pkt.moduleId === Module.SYSTEM && pkt.commandId === SysCmd.DEVICE_INFO_RESPONSE) {
    const info = parseDeviceInfo(pkt.payload);
    if (info) renderDeviceInfo(info);
  }
  if (pkt.moduleId === Module.MEDIA && pkt.commandId === MediaCmd.ID_RESPONSE) {
    const r = parseMediaIdResponse(pkt.payload);
    if (r?.success) {
      state.mediaId = Number(r.mediaId);
      $('#mediaIdValue').textContent = String(state.mediaId);
    }
  }

  for (const [, w] of state.waiters) {
    if (w.predicate(pkt)) {
      w.resolve(pkt);
      break;
    }
  }
}

function renderDeviceInfo(info) {
  const box = $('#deviceInfo');
  const fmt = (n) => (n == null ? '—' : typeof n === 'bigint' ? n.toString() : String(n));
  box.innerHTML = `
    <dl>
      <dt>Name</dt><dd>${escapeHtml(info.name || '—')}</dd>
      <dt>Firmware</dt><dd>${escapeHtml(info.deviceVersion || '—')}</dd>
      <dt>Protocol</dt><dd>${escapeHtml(info.protocolVersion || '—')}</dd>
      <dt>Storage</dt><dd>${fmt(info.freeStorage)} / ${fmt(info.storageCapacity)} free/total</dd>
      <dt>Max file</dt><dd>${fmt(info.maxFileSize)}</dd>
      <dt>File types</dt><dd>${(info.fileTypes || []).join(', ') || '—'}</dd>
      <dt>Features</dt><dd>${escapeHtml(info.features || '—')}</dd>
    </dl>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setConnectedUi(on) {
  $$('[data-requires-conn]').forEach((el) => {
    el.disabled = !on;
  });
  $('#btnConnect').hidden = on;
  $('#btnDisconnect').hidden = !on;
  setStatus(on ? `Connected · ${state.ble?.device?.name || 'device'}` : 'Disconnected', on ? 'ok' : '');
}

async function connect(acceptAll) {
  if (!SuperBandBle.supported()) {
    setStatus('Web Bluetooth unavailable', 'err');
    logLine({
      msg: 'Use Chrome/Edge on desktop or Android, over HTTPS or http://localhost',
      level: 'err',
    });
    return;
  }
  state.ble = new SuperBandBle({
    onLog: logLine,
    onPacket: dispatchPacket,
    onConnectionChange: setConnectedUi,
  });
  try {
    setStatus('Connecting…', 'busy');
    await state.ble.connect({ acceptAll });
    const bat = await state.ble.readBattery();
    if (bat != null) logLine({ msg: `Battery ${bat}%`, level: 'info' });
    await state.ble.write(buildDeviceInfoRequest(), 'DEVICE_INFO_REQUEST');
  } catch (e) {
    setStatus('Connect failed', 'err');
    logLine({ msg: e.message, level: 'err' });
    setConnectedUi(false);
  }
}

async function sendBuilt(bytes, label) {
  if (!state.ble?.connected) throw new Error('Not connected');
  await state.ble.write(bytes, label);
}

async function allocateMediaId() {
  await sendBuilt(buildMediaIdRequest(), 'MEDIA_ID_REQUEST');
  const pkt = await waitFor(
    (p) => p.moduleId === Module.MEDIA && p.commandId === MediaCmd.ID_RESPONSE,
    { timeoutMs: 30000, label: 'MEDIA_ID_RESPONSE' },
  );
  const r = parseMediaIdResponse(pkt.payload);
  if (!r?.success) throw new Error(`Media ID failed: ${r?.message || 'unknown'}`);
  state.mediaId = Number(r.mediaId);
  $('#mediaIdValue').textContent = String(state.mediaId);
  return state.mediaId;
}

async function transferFile(fileBytes, { fileType, functionType, mediaId }) {
  if (state.transferring) throw new Error('Transfer already in progress');
  state.transferring = true;
  const progress = $('#transferProgress');
  const bar = $('#transferBar');
  progress.hidden = false;
  bar.style.width = '0%';

  const fileId = state.fileId++;
  const checksum = crc32(fileBytes);
  logLine({
    msg: `Transfer start fileId=${fileId} size=${fileBytes.length} crc=0x${checksum.toString(16)} mediaId=${mediaId}`,
    level: 'info',
  });

  try {
    await sendBuilt(
      buildTransferStart({
        fileSize: fileBytes.length,
        fileType,
        functionType,
        mediaId,
      }),
      'TRANSFER_START',
    );

    const ackPkt = await waitFor(
      (p) =>
        p.moduleId === Module.FILE_TRANSFER &&
        (p.commandId === FileCmd.TRANSFER_ACK || p.commandId === FileCmd.TRANSFER_NACK),
      { timeoutMs: 30000, label: 'TRANSFER_ACK' },
    );

    if (ackPkt.commandId === FileCmd.TRANSFER_NACK) {
      const n = parseNack(ackPkt.payload);
      throw new Error(`NACK: ${n?.errorCode} ${n?.message || ''}`);
    }

    const ack = parseAck(ackPkt.payload);
    const useFileId = ack?.fileId != null ? ack.fileId : fileId;
    logLine({ msg: `ACK fileId=${useFileId}`, level: 'ok' });

    const chunkSize = PROTOCOL.MAX_CHUNK;
    const totalChunks = Math.ceil(fileBytes.length / chunkSize) || 1;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fileBytes.length);
      const slice = fileBytes.slice(start, end);
      const isLast = end >= fileBytes.length;
      await sendBuilt(
        buildFileData({ fileId: useFileId, chunkIndex: i, data: slice, isLast }),
        `FILE_DATA[${i}]`,
      );
      bar.style.width = `${Math.round(((i + 1) / totalChunks) * 90)}%`;

      // Drain optional NEXT_CHUNK / RETRY without blocking forever
      await Promise.race([
        waitFor(
          (p) =>
            p.moduleId === Module.FILE_TRANSFER &&
            (p.commandId === FileCmd.NEXT_CHUNK ||
              p.commandId === FileCmd.RETRY ||
              p.commandId === FileCmd.TRANSFER_ACK),
          { timeoutMs: 80, label: 'chunk-flow' },
        ).catch(() => null),
        new Promise((r) => setTimeout(r, 20)),
      ]);
    }

    await sendBuilt(buildTransferComplete(useFileId, checksum), 'TRANSFER_COMPLETE');
    await sendBuilt(buildVerificationRequest(useFileId), 'VERIFICATION_RESULT');

    try {
      const ver = await waitFor(
        (p) =>
          p.moduleId === Module.FILE_TRANSFER && p.commandId === FileCmd.VERIFICATION_RESULT,
        { timeoutMs: 30000, label: 'VERIFICATION_RESULT' },
      );
      const ok = ver.payload.length >= 9 ? ver.payload[8] === 1 : false;
      logLine({
        msg: ok ? 'Verification OK' : `Verification response: ${toHex(ver.payload)}`,
        level: ok ? 'ok' : 'warn',
      });
    } catch (e) {
      logLine({ msg: `No verification response: ${e.message}`, level: 'warn' });
    }

    bar.style.width = '100%';
    logLine({ msg: 'Transfer finished', level: 'ok' });
  } finally {
    state.transferring = false;
    setTimeout(() => {
      progress.hidden = true;
    }, 1200);
  }
}

function bindTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.panel').forEach((p) => p.classList.toggle('active', p.id === tab.dataset.panel));
    });
  });
}

function bindUi() {
  $('#btnConnect').addEventListener('click', () => connect(false));
  $('#btnConnectAny').addEventListener('click', () => connect(true));
  $('#btnDisconnect').addEventListener('click', () => state.ble?.disconnect());
  $('#btnClearLog').addEventListener('click', () => {
    $('#console').innerHTML = '';
  });

  $('#btnDeviceInfo').addEventListener('click', () =>
    sendBuilt(buildDeviceInfoRequest(), 'DEVICE_INFO_REQUEST').catch((e) =>
      logLine({ msg: e.message, level: 'err' }),
    ),
  );
  $('#btnMediaId').addEventListener('click', () =>
    allocateMediaId().catch((e) => logLine({ msg: e.message, level: 'err' })),
  );
  $('#btnMediaList').addEventListener('click', () =>
    sendBuilt(buildMediaListRequest(), 'MEDIA_LIST_REQUEST').catch((e) =>
      logLine({ msg: e.message, level: 'err' }),
    ),
  );
  $('#btnPair').addEventListener('click', () =>
    sendBuilt(buildPairingFrame(), 'legacy pair').catch((e) =>
      logLine({ msg: e.message, level: 'err' }),
    ),
  );
  $('#btnStatus').addEventListener('click', () =>
    sendBuilt(buildStatusQuery(), 'STATUS').catch((e) =>
      logLine({ msg: e.message, level: 'err' }),
    ),
  );

  $('#btnDeleteMedia').addEventListener('click', async () => {
    const id = Number($('#deleteMediaId').value);
    if (!Number.isFinite(id)) return;
    try {
      await sendBuilt(buildMediaDelete(id), 'MEDIA_DELETE');
    } catch (e) {
      logLine({ msg: e.message, level: 'err' });
    }
  });

  $('#btnSendHex').addEventListener('click', async () => {
    try {
      const bytes = fromHex($('#hexInput').value);
      await sendBuilt(bytes, 'raw hex');
    } catch (e) {
      logLine({ msg: e.message, level: 'err' });
    }
  });

  $('#btnSendCmd').addEventListener('click', async () => {
    try {
      const mod = Number($('#cmdModule').value);
      const cmd = Number($('#cmdId').value);
      const payloadHex = $('#cmdPayload').value.trim();
      const payload = payloadHex ? fromHex(payloadHex) : new Uint8Array(0);
      await sendBuilt(buildPacket(mod, cmd, payload), `MOD ${mod} CMD ${cmd}`);
    } catch (e) {
      logLine({ msg: e.message, level: 'err' });
    }
  });

  $('#btnPushFile').addEventListener('click', async () => {
    const input = $('#fileInput');
    const file = input.files?.[0];
    if (!file) {
      logLine({ msg: 'Choose a file first', level: 'warn' });
      return;
    }
    try {
      let mediaId = state.mediaId;
      if (mediaId == null || $('#allocMedia').checked) {
        mediaId = await allocateMediaId();
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const fileType = Number($('#fileType').value);
      const functionType = Number($('#functionType').value);
      await transferFile(buf, { fileType, functionType, mediaId });
    } catch (e) {
      logLine({ msg: e.message, level: 'err' });
    }
  });

  $('#btnStopTransfer').addEventListener('click', async () => {
    try {
      await sendBuilt(buildTransferStop(state.fileId), 'TRANSFER_STOP');
    } catch (e) {
      logLine({ msg: e.message, level: 'err' });
    }
  });
}

function initSupportBanner() {
  const el = $('#bleSupport');
  if (SuperBandBle.supported()) {
    el.textContent = 'Web Bluetooth ready';
    el.dataset.kind = 'ok';
  } else {
    el.textContent = 'Web Bluetooth not supported in this browser';
    el.dataset.kind = 'err';
  }
}

bindTabs();
bindUi();
initSupportBanner();
setConnectedUi(false);
logLine({
  msg: 'SuperBand BLE console ready. Connect a badge (name …_Vn_BadgeOK, mfg 0xAA01).',
  level: 'info',
});
