import { SuperBandClient, FileType, FunctionType } from './client.js';
import { prepareFileForBadge, formatBytes } from './image.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const client = new SuperBandClient();
let prepared = null;

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

function renderDeviceInfo(info) {
  const root = $('#deviceStats');
  root.querySelector('[data-field="name"]').textContent =
    client.name || info?.name || '—';
  root.querySelector('[data-field="fw"]').textContent = info?.deviceVersion || '—';
  root.querySelector('[data-field="proto"]').textContent = info?.protocolVersion || '—';
  root.querySelector('[data-field="free"]').textContent = fmtBig(info?.freeStorage);
  root.querySelector('[data-field="cap"]').textContent = fmtBig(info?.storageCapacity);
}

function renderBattery(level) {
  $('#deviceStats').querySelector('[data-field="battery"]').textContent =
    level == null ? '—' : `${level}%`;
}

function renderMediaList(items) {
  const box = $('#mediaList');
  if (!items?.length) {
    box.innerHTML = '<div class="empty">No media entries parsed (device may use a different list layout).</div>';
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
    row.querySelector('.sub').textContent = `id=${item.mediaId} · ${formatBytes(item.fileSize)} · type=${item.fileType}`;
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
    toast('Badge connected', 'ok');
  } catch (e) {
    setConnected(false);
    setPill($('#connPill'), 'Connect failed', 'err');
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  }
}

async function rebuildPreview() {
  const file = $('#imageInput').files?.[0];
  if (!file) return;
  try {
    prepared = await prepareFileForBadge(file, {
      width: Number($('#dialW').value) || 320,
      height: Number($('#dialH').value) || 384,
      quality: 0.5,
      round: $('#roundMask').checked,
    });
    const img = $('#dialPreview');
    img.src = prepared.previewUrl;
    img.hidden = false;
    $('#dialPlaceholder').hidden = true;
    $('#dial').classList.toggle('round', $('#roundMask').checked);
    $('#imageMeta').textContent = `${file.name} → ${prepared.width}×${prepared.height} JPEG · ${formatBytes(prepared.bytes.length)}`;
  } catch (e) {
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  }
}

async function pushImage() {
  if (!prepared) {
    toast('Choose an image first', 'err');
    return;
  }
  const bar = $('#pushBar');
  const wrap = $('#pushProgress');
  wrap.hidden = false;
  bar.style.width = '0%';
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
  } catch (e) {
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  } finally {
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
    client.refreshDeviceInfo().catch((e) => toast(e.message, 'err')),
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
      renderDeviceInfo(null);
      renderBattery(null);
    }
  });
  client.addEventListener('deviceinfo', (e) => renderDeviceInfo(e.detail.info));
  client.addEventListener('battery', (e) => renderBattery(e.detail.level));
  client.addEventListener('mediaid', (e) => {
    $('#mediaIdPill').textContent = `Media ID ${e.detail.mediaId}`;
  });
  client.addEventListener('medialist', (e) => renderMediaList(e.detail.items));
}

function initSupport() {
  if (SuperBandClient.supported()) {
    setPill($('#blePill'), 'Web Bluetooth ready', 'ok');
  } else {
    setPill($('#blePill'), 'Web Bluetooth unavailable', 'err');
    $('#btnConnect').disabled = true;
    $('#btnConnectAny').disabled = true;
  }
}

bind();
initSupport();
setConnected(false);
log({ msg: 'SuperBand manager ready. Connect a badge to begin.', level: 'info' });
