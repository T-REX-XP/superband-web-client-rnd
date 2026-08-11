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

function setConnected(on) {
  $$('[data-need-conn]').forEach((b) => {
    b.disabled = !on;
  });
  $('#btnConnect').hidden = on;
  $('#btnConnectAny').hidden = on;
  $('#btnDisconnect').hidden = !on;
  setPill(
    $('#connPill'),
    on ? `Connected · ${client.name || 'badge'}` : 'Disconnected',
    on ? 'ok' : '',
  );
  $('#deviceGlance').hidden = !on;
  updatePushChecklist();
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
  const battery =
    s.battery == null ? '—' : `${s.battery}%`;

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

  if (s.mediaId != null) {
    $('#mediaIdPill').textContent = `Media ID ${s.mediaId}`;
  }
}

function updatePushChecklist() {
  const connected = client.connected;
  const imageReady = !!prepared;
  const idle = !transferring;
  const map = { conn: connected, image: imageReady, idle };
  for (const [key, ok] of Object.entries(map)) {
    const li = document.querySelector(`[data-check="${key}"]`);
    if (!li) continue;
    li.dataset.ok = ok ? '1' : '0';
  }
  const btn = $('#btnPush');
  btn.disabled = !(connected && imageReady && idle);
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
    setConnected(true);
    renderSnapshot();
    toast('Badge connected', 'ok');
    // Best-effort media list — failures are non-fatal for push.
    client.requestMediaList().catch((e) => {
      log({ msg: `Media list: ${e.message}`, level: 'warn' });
    });
  } catch (e) {
    setConnected(false);
    setPill($('#connPill'), 'Connect failed', 'err');
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
    toast(
      result.verified === false ? 'Uploaded (verify unclear)' : 'Image pushed',
      'ok',
    );
    log({
      msg: `Push complete mediaId=${result.mediaId} crc=0x${result.checksum.toString(16)}`,
      level: 'ok',
    });
    $('#mediaIdPill').textContent = `Media ID ${result.mediaId}`;
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

function bind() {
  $('#btnConnect').addEventListener('click', () => connect(false));
  $('#btnConnectAny').addEventListener('click', () => connect(true));
  $('#btnDisconnect').addEventListener('click', () => client.disconnect());
  $('#btnRefresh').addEventListener('click', () =>
    client
      .refreshIdentity()
      .then(() => {
        renderSnapshot();
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
  client.addEventListener('connection', (e) => {
    setConnected(e.detail.connected);
    if (!e.detail.connected) {
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
  });
  client.addEventListener('snapshot', (e) => renderSnapshot(e.detail.snapshot));
  client.addEventListener('deviceinfo', () => renderSnapshot());
  client.addEventListener('disinfo', () => renderSnapshot());
  client.addEventListener('battery', () => renderSnapshot());
  client.addEventListener('mediaid', (e) => {
    $('#mediaIdPill').textContent = `Media ID ${e.detail.mediaId}`;
  });
  client.addEventListener('medialist', (e) => renderMediaList(e.detail.items));
}

function initSupport() {
  const secure = window.isSecureContext;
  if (!secure) {
    setPill($('#blePill'), 'Needs HTTPS (or localhost)', 'err');
    $('#btnConnect').disabled = true;
    $('#btnConnectAny').disabled = true;
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
setConnected(false);
updatePushChecklist();
log({ msg: 'SuperBand manager ready. Connect a badge to begin.', level: 'info' });
