import { SuperBandClient, FileType, FunctionType } from './client.js';
import { prepareFileForBadge, formatBytes, DEFAULT_DIAL } from './image.js';
import { REPO_URL } from './protocol.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const client = new SuperBandClient();
let prepared = null;
let transferring = false;

function setPill(el, text, state = '') {
  el.textContent = text;
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
}

function syncConnectionChrome() {
  const n = client.sessionCount;
  const on = n > 0 && client.connected;
  $$('[data-need-conn]').forEach((b) => {
    b.disabled = !on;
  });

  // Always allow adding another device while Web Bluetooth works
  $('#btnConnect').hidden = false;
  $('#btnConnectAny').hidden = false;
  $('#btnConnect').textContent = n ? 'Add badge' : 'Connect badge';
  $('#btnConnectAny').textContent = n ? 'Add other' : 'Other device';
  $('#btnAddBadge').hidden = n === 0;
  $('#btnDisconnect').hidden = n === 0;
  $('#btnDisconnectAll').hidden = n < 2;
  $('#btnPushAll').hidden = n < 2;

  const label =
    n === 0
      ? 'Disconnected'
      : n === 1
        ? `Connected · ${client.name || 'badge'}`
        : `${n} badges · active ${client.name || '—'}`;
  setPill($('#connPill'), label, n ? 'ok' : '');
  $('#deviceGlance').hidden = !on;
  $('#deviceRail').hidden = n === 0;
  $('#deviceCount').textContent = String(n);
  updatePushChecklist();
}

function renderDeviceChips() {
  const box = $('#deviceChips');
  box.innerHTML = '';
  for (const s of client.sessions) {
    const chip = document.createElement('div');
    chip.className = 'device-chip' + (s.active ? ' active' : '');
    chip.dataset.id = s.id;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'device-chip-main';
    main.title = 'Make active';
    const title = s.name || 'Badge';
    const sub = [s.firmware, s.battery != null ? `${s.battery}%` : null].filter(Boolean).join(' · ');
    main.innerHTML = `<span class="chip-name"></span><span class="chip-sub"></span>`;
    main.querySelector('.chip-name').textContent = title + (s.active ? ' · active' : '');
    main.querySelector('.chip-sub').textContent = sub || s.id.slice(0, 8);
    main.addEventListener('click', () => {
      try {
        client.setActive(s.id);
        toast(`Active: ${client.name || s.id}`, 'ok');
        if (client.getSnapshot().protocolMode === 'baji') {
          client.requestMediaList().catch((e) => {
            log({ msg: `Media list: ${e.message}`, level: 'warn' });
          });
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'device-chip-x';
    x.title = 'Disconnect this badge';
    x.textContent = '×';
    x.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await client.disconnect(s.id);
        toast('Badge disconnected', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    chip.appendChild(main);
    chip.appendChild(x);
    box.appendChild(chip);
  }
}

function log({ msg, level = 'info' }) {
  const box = $('#activityLog');
  const row = document.createElement('div');
  row.className = `log-line ${level}`;
  row.innerHTML = `<span class="t"></span><span class="m"></span>`;
  row.querySelector('.t').textContent = new Date().toLocaleTimeString();
  row.querySelector('.m').textContent = msg;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.hidden = false;
  el.dataset.kind = kind;
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.hidden = true;
    }, 280);
  }, 2800);
}

function fmtBig(n) {
  if (n == null) return '—';
  const v = typeof n === 'bigint' ? Number(n) : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return formatBytes(v);
}

function dash(v) {
  return v == null || v === '' ? '—' : String(v);
}

function renderSnapshot(snap) {
  const s = snap || client.getSnapshot();
  const battery = s.battery == null ? '—' : `${s.battery}%`;

  const fields = {
    name: dash(s.name),
    model: dash(s.model),
    firmware: dash(s.firmware),
    hardware: dash(s.hardware),
    software: dash(s.software),
    manufacturer: dash(s.manufacturer),
    battery,
    protocol: dash(s.protocol),
    free: fmtBig(s.freeStorage),
    cap: fmtBig(s.storageCapacity),
  };

  for (const [key, val] of Object.entries(fields)) {
    $$('[data-field="' + key + '"]').forEach((el) => {
      el.textContent = val;
    });
  }

  const glance = {
    name: fields.name,
    model: fields.model,
    firmware: fields.firmware,
    battery: fields.battery,
    hardware: fields.hardware,
    free: fields.free,
  };
  for (const [key, val] of Object.entries(glance)) {
    const el = document.querySelector(`[data-glance="${key}"]`);
    if (el) el.textContent = val;
  }

  if (s.protocolMode === 'fitpro') {
    $('#mediaIdPill').textContent = 'FitPro dial31';
    if (s.dialWidth && s.dialHeight) {
      const w = $('#dialW');
      const h = $('#dialH');
      if (w && Number(w.value) !== s.dialWidth) w.value = String(s.dialWidth);
      if (h && Number(h.value) !== s.dialHeight) h.value = String(s.dialHeight);
    }
  } else if (s.mediaId != null) {
    $('#mediaIdPill').textContent = `Media ID ${s.mediaId}`;
  } else if (!s.connected) {
    $('#mediaIdPill').textContent = 'Media ID —';
  }
}

function updatePushChecklist() {
  const connected = client.connected;
  const imageReady = !!prepared;
  const idle = !transferring && !client.active?.getSnapshot()?.transferring;
  const map = { conn: connected, image: imageReady, idle };
  for (const [key, ok] of Object.entries(map)) {
    const li = document.querySelector(`[data-check="${key}"]`);
    if (!li) continue;
    li.dataset.ok = ok ? '1' : '0';
  }
  const canPush = connected && imageReady && idle;
  $('#btnPush').disabled = !canPush;
  $('#btnPushAll').disabled = !(client.sessionCount >= 2 && imageReady && idle);
}

function renderMediaList(items) {
  const box = $('#mediaList');
  if (!items?.length) {
    box.innerHTML =
      '<div class="empty">No media entries parsed (device may use a different list layout). Push still works.</div>';
    return;
  }
  box.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'media-item';
    row.innerHTML = `
      <div class="meta">
        <div class="title"></div>
        <div class="sub"></div>
      </div>
      <button class="danger" type="button">Delete</button>`;
    row.querySelector('.title').textContent = item.name || `Media ${item.mediaId}`;
    row.querySelector('.sub').textContent =
      `id=${item.mediaId} · ${formatBytes(item.fileSize)} · type=${item.fileType}`;
    row.querySelector('button').addEventListener('click', async () => {
      try {
        await client.deleteMedia(item.mediaId);
        toast(`Delete sent for ${item.mediaId}`, 'ok');
        await client.requestMediaList().catch(() => {});
      } catch (e) {
        toast(e.message, 'err');
        log({ msg: e.message, level: 'err' });
      }
    });
    box.appendChild(row);
  }
}

async function connect(acceptAll) {
  try {
    setPill($('#connPill'), 'Connecting…', 'busy');
    await client.connect({ acceptAll });
    syncConnectionChrome();
    renderDeviceChips();
    renderSnapshot();
    toast(
      client.sessionCount > 1
        ? `Added · ${client.sessionCount} badges connected`
        : 'Badge connected',
      'ok',
    );
    const snap = client.getSnapshot();
    if (snap.protocolMode === 'baji') {
      client.requestMediaList().catch((e) => {
        log({ msg: `Media list: ${e.message}`, level: 'warn' });
      });
    } else if (snap.protocolMode === 'fitpro') {
      log({ msg: 'FitPro badge — media library skipped (use Push for dial31 upload)', level: 'info' });
    }
  } catch (e) {
    syncConnectionChrome();
    renderDeviceChips();
    if (!client.sessionCount) {
      setPill($('#connPill'), 'Connect failed', 'err');
    }
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  }
}

async function rebuildPreview() {
  const file = $('#imageInput').files?.[0];
  if (!file) {
    prepared = null;
    updatePushChecklist();
    return;
  }
  try {
    prepared = await prepareFileForBadge(file, {
      width: Number($('#dialW').value) || DEFAULT_DIAL.width,
      height: Number($('#dialH').value) || DEFAULT_DIAL.height,
      quality: 0.5,
      round: $('#roundMask').checked,
    });
    const img = $('#dialPreview');
    img.src = prepared.previewUrl;
    img.hidden = false;
    $('#dialPlaceholder').hidden = true;
    $('#dial').classList.toggle('round', $('#roundMask').checked);
    $('#imageMeta').textContent =
      `${file.name} → ${prepared.width}×${prepared.height} JPEG · ${formatBytes(prepared.bytes.length)}`;
    updatePushChecklist();
  } catch (e) {
    prepared = null;
    updatePushChecklist();
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  }
}

async function pushImage() {
  if (!client.connected) {
    toast('Connect a badge first', 'err');
    return;
  }
  if (!prepared) {
    toast('Choose an image first', 'err');
    return;
  }
  const bar = $('#pushBar');
  const wrap = $('#pushProgress');
  wrap.hidden = false;
  bar.style.width = '0%';
  transferring = true;
  updatePushChecklist();
  try {
    const functionType = Number($('#functionType').value) || FunctionType.BACKGROUND;
    const result = await client.transferFile(prepared.bytes, {
      fileType: FileType.IMAGE,
      functionType,
      allocateId: $('#allocMedia').checked,
      onProgress: (pct) => {
        bar.style.width = `${pct}%`;
      },
    });
    const via = result.path === 'fitpro-dial31' ? 'dial31' : 'baji';
    toast(
      result.verified === false
        ? 'Uploaded (verify unclear)'
        : `Pushed to ${client.name || 'badge'} (${via})`,
      'ok',
    );
    log({
      msg: `Push complete → ${client.name || result.sessionId} via=${via} id=${result.mediaId} sum=0x${Number(result.checksum).toString(16)}`,
      level: 'ok',
    });
    if (via === 'baji') {
      $('#mediaIdPill').textContent = `Media ID ${result.mediaId}`;
      client.requestMediaList().catch(() => {});
    } else {
      $('#mediaIdPill').textContent = 'FitPro dial31';
    }
  } catch (e) {
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  } finally {
    transferring = false;
    updatePushChecklist();
    setTimeout(() => {
      wrap.hidden = true;
    }, 900);
  }
}

async function pushAll() {
  if (client.sessionCount < 2) {
    toast('Connect at least two badges', 'err');
    return;
  }
  if (!prepared) {
    toast('Choose an image first', 'err');
    return;
  }
  const bar = $('#pushBar');
  const wrap = $('#pushProgress');
  wrap.hidden = false;
  bar.style.width = '0%';
  transferring = true;
  updatePushChecklist();
  try {
    const functionType = Number($('#functionType').value) || FunctionType.BACKGROUND;
    const results = await client.transferFileToAll(prepared.bytes, {
      fileType: FileType.IMAGE,
      functionType,
      allocateId: $('#allocMedia').checked,
      onProgress: (pct) => {
        bar.style.width = `${pct}%`;
      },
    });
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    toast(
      fail ? `Pushed to ${ok}/${results.length} badges` : `Pushed to all ${ok} badges`,
      fail ? 'err' : 'ok',
    );
    for (const r of results) {
      log({
        msg: r.ok
          ? `Push OK → ${r.name || r.sessionId} mediaId=${r.mediaId}`
          : `Push fail → ${r.name || r.sessionId}: ${r.error}`,
        level: r.ok ? 'ok' : 'err',
      });
    }
    renderSnapshot();
    client.requestMediaList().catch(() => {});
  } catch (e) {
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  } finally {
    transferring = false;
    updatePushChecklist();
    setTimeout(() => {
      wrap.hidden = true;
    }, 900);
  }
}

function clearActiveUi() {
  renderSnapshot({
    name: null,
    model: null,
    firmware: null,
    hardware: null,
    software: null,
    manufacturer: null,
    battery: null,
    protocol: null,
    freeStorage: null,
    storageCapacity: null,
    mediaId: null,
  });
  $('#mediaList').innerHTML = '<div class="empty">Connect and refresh to load media.</div>';
  $('#mediaIdPill').textContent = 'Media ID —';
}

function bind() {
  $('#btnConnect').addEventListener('click', () => connect(false));
  $('#btnConnectAny').addEventListener('click', () => connect(true));
  $('#btnAddBadge').addEventListener('click', () => connect(false));
  $('#btnDisconnect').addEventListener('click', () =>
    client.disconnect().then(() => toast('Disconnected', 'ok')),
  );
  $('#btnDisconnectAll').addEventListener('click', () =>
    client.disconnectAll().then(() => toast('All badges disconnected', 'ok')),
  );
  $('#btnRefresh').addEventListener('click', () =>
    client
      .refreshIdentity()
      .then(() => {
        renderSnapshot();
        renderDeviceChips();
        toast('Device info refreshed', 'ok');
      })
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnPair').addEventListener('click', () =>
    client.pair().catch((e) => toast(e.message, 'err')),
  );
  $('#btnPickImage').addEventListener('click', () => $('#imageInput').click());
  $('#imageInput').addEventListener('change', () => rebuildPreview());
  $('#dialW').addEventListener('change', () => rebuildPreview());
  $('#dialH').addEventListener('change', () => rebuildPreview());
  $('#roundMask').addEventListener('change', () => rebuildPreview());
  $('#btnPush').addEventListener('click', () => pushImage());
  $('#btnPushAll').addEventListener('click', () => pushAll());
  $('#btnMediaList').addEventListener('click', () =>
    client.requestMediaList().catch((e) => {
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    }),
  );
  $('#btnAllocId').addEventListener('click', () =>
    client
      .allocateMediaId()
      .then((id) => {
        $('#mediaIdPill').textContent = `Media ID ${id}`;
        toast(`Allocated ${id}`, 'ok');
      })
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnClearLog').addEventListener('click', () => {
    $('#activityLog').innerHTML = '';
  });

  client.addEventListener('log', (e) => log(e.detail));
  client.addEventListener('sessions', () => {
    syncConnectionChrome();
    renderDeviceChips();
  });
  client.addEventListener('connection', (e) => {
    syncConnectionChrome();
    renderDeviceChips();
    if (!e.detail.connected && client.sessionCount === 0) {
      clearActiveUi();
    } else {
      renderSnapshot();
    }
  });
  client.addEventListener('snapshot', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      renderSnapshot(e.detail.snapshot);
    }
    renderDeviceChips();
  });
  client.addEventListener('deviceinfo', () => renderSnapshot());
  client.addEventListener('disinfo', () => renderSnapshot());
  client.addEventListener('battery', () => {
    renderSnapshot();
    renderDeviceChips();
  });
  client.addEventListener('mediaid', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      $('#mediaIdPill').textContent = `Media ID ${e.detail.mediaId}`;
    }
  });
  client.addEventListener('medialist', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      renderMediaList(e.detail.items);
    }
  });
}

function initSupport() {
  const secure = window.isSecureContext;
  if (!secure) {
    setPill($('#blePill'), 'Needs HTTPS (or localhost)', 'err');
    $('#btnConnect').disabled = true;
    $('#btnConnectAny').disabled = true;
    $('#btnAddBadge').disabled = true;
    log({
      msg: 'Insecure context — Web Bluetooth is blocked. Use GitHub Pages HTTPS or localhost.',
      level: 'err',
    });
    return;
  }
  if (SuperBandClient.supported()) {
    setPill($('#blePill'), 'Web Bluetooth ready', 'ok');
  } else {
    setPill($('#blePill'), 'Web Bluetooth unavailable', 'err');
    $('#btnConnect').disabled = true;
    $('#btnConnectAny').disabled = true;
    $('#btnAddBadge').disabled = true;
  }
}

async function initBuildMeta() {
  const el = $('#buildMeta');
  if (!el) return;
  try {
    const res = await fetch(new URL('version.json', import.meta.url));
    if (!res.ok) throw new Error('no version');
    const data = await res.json();
    if (data?.version) {
      el.innerHTML = '';
      const a = document.createElement('a');
      a.href = REPO_URL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = `SuperBand v${data.version}`;
      el.appendChild(a);
      if (data.built_at) {
        el.appendChild(document.createTextNode(` · ${data.built_at}`));
      }
      return;
    }
  } catch {
    // fall through
  }
  el.innerHTML = '';
  const a = document.createElement('a');
  a.href = REPO_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = 'SuperBand on GitHub';
  el.appendChild(a);
}

bind();
initSupport();
initBuildMeta();
syncConnectionChrome();
updatePushChecklist();
log({
  msg: 'SuperBand manager ready. Connect one or more badges (each Add opens the picker).',
  level: 'info',
});
