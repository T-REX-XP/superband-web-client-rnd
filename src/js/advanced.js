/**
 * Advanced tab — OTA prepare/probe/flash + protocol helpers (tools/send-ota.sh parity).
 */

import {
  OTA_PRESETS,
  probeOtaCatalog,
  loadOtaPackageFromFile,
  loadOtaPackageFromPreset,
  USB_HINT,
  SECURITY_FINDINGS,
} from './ota-catalog.js';
import { findJieliOtaChars, listGattSummary, runJieliOta, JIELI_OTA } from './jieli-ota.js';
import { GATT } from './protocol.js';
import { formatBytes } from './image.js';

/**
 * @param {{ client: import('./client.js').SuperBandClient, log: Function, toast: Function, $: Function }} ctx
 */
export function bindAdvanced(ctx) {
  const { client, log, toast, $ } = ctx;
  /** @type {null | Awaited<ReturnType<typeof loadOtaPackageFromPreset>>} */
  let otaPkg = null;
  let flashing = false;

  const meta = () => $('#otaPackageMeta');
  const flashMeta = () => $('#otaFlashMeta');

  function setPackage(pkg) {
    otaPkg = pkg;
    if (!pkg) {
      meta().textContent = 'No package loaded.';
      flashMeta().textContent = 'Load a package first.';
      return;
    }
    meta().textContent = [
      pkg.label || pkg.fileName,
      `ufw=${pkg.ufwName}`,
      formatBytes(pkg.ufwBytes.length),
      `sha256=${pkg.sha256.slice(0, 16)}…`,
      pkg.chipkey || '',
    ]
      .filter(Boolean)
      .join(' · ');
    flashMeta().textContent = `Ready: ${pkg.ufwName} (${formatBytes(pkg.ufwBytes.length)})`;
  }

  function renderFindings() {
    const ul = $('#securityFindings');
    ul.innerHTML = '';
    for (const f of SECURITY_FINDINGS) {
      const li = document.createElement('li');
      li.dataset.sev = f.sev;
      li.innerHTML = `<span class="sev">${f.sev}</span> <span class="id">${f.id}</span> ${f.title}`;
      ul.appendChild(li);
    }
  }

  $('#usbHintOut').textContent = USB_HINT;
  renderFindings();

  // Tabs
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.querySelectorAll('.tab-panel').forEach((p) => {
        const on = p.id === `tab-${id}`;
        p.hidden = !on;
        p.classList.toggle('active', on);
      });
    });
  });

  async function preparePreset() {
    const id = $('#otaPreset').value;
    const bar = $('#otaDlBar');
    const wrap = $('#otaDlProgress');
    wrap.hidden = false;
    bar.style.width = '0%';
    try {
      log({ msg: `OTA: downloading preset ${id}…`, level: 'info' });
      const pkg = await loadOtaPackageFromPreset(id, {
        onProgress: (p) => {
          bar.style.width = `${p}%`;
        },
      });
      setPackage(pkg);
      toast(`Prepared ${pkg.ufwName}`, 'ok');
      log({
        msg: `OTA package ready ${pkg.ufwName} ${formatBytes(pkg.ufwBytes.length)} sha=${pkg.sha256.slice(0, 12)}`,
        level: 'ok',
      });
    } catch (e) {
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    } finally {
      setTimeout(() => {
        wrap.hidden = true;
      }, 600);
    }
  }

  $('#btnOtaPrepare').addEventListener('click', () => preparePreset());
  $('#btnOtaPick').addEventListener('click', () => $('#otaFileInput').click());
  $('#otaFileInput').addEventListener('change', async () => {
    const file = $('#otaFileInput').files?.[0];
    if (!file) return;
    try {
      const pkg = await loadOtaPackageFromFile(file);
      setPackage(pkg);
      toast(`Loaded ${pkg.ufwName}`, 'ok');
      log({ msg: `OTA local file → ${pkg.ufwName} ${formatBytes(pkg.ufwBytes.length)}`, level: 'ok' });
    } catch (e) {
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    }
  });

  $('#btnOtaProbeCatalog').addEventListener('click', async () => {
    const version = $('#otaCatVersion').value.trim();
    const name = $('#otaCatName').value.trim() || 'BJ-1';
    try {
      log({ msg: `OTA catalog probe name=${name} version=${version}`, level: 'info' });
      const r = await probeOtaCatalog({ name, version });
      const out = $('#gattProbeOut');
      out.textContent = JSON.stringify(r.body ?? r, null, 2);
      if (r.downloadUrl) {
        log({ msg: `Catalog URL: ${r.downloadUrl}`, level: 'ok' });
        toast('Catalog hit — downloading…', 'ok');
        const bar = $('#otaDlBar');
        const wrap = $('#otaDlProgress');
        wrap.hidden = false;
        const { downloadZip, extractUfwFromZip, sha256Hex } = await import('./ota-catalog.js');
        const zipBytes = await downloadZip(r.downloadUrl, {
          onProgress: (p) => {
            bar.style.width = `${p}%`;
          },
        });
        const { name: ufwName, bytes } = extractUfwFromZip(zipBytes);
        setPackage({
          source: 'catalog',
          fileName: r.downloadUrl.split('/').pop(),
          ufwName,
          ufwBytes: bytes,
          zipBytes,
          sha256: await sha256Hex(bytes),
          chipkey: '$B165',
          url: r.downloadUrl,
          label: `${r.catalogName || name} ${r.catalogVersion || version}`,
        });
        wrap.hidden = true;
        toast('Package from catalog ready', 'ok');
      } else {
        toast(r.body?.error?.message || 'No download in catalog', 'err');
      }
    } catch (e) {
      toast(
        /Failed to fetch|CORS|NetworkError/i.test(e.message)
          ? 'Catalog blocked by CORS — use CDN preset or local file'
          : e.message,
        'err',
      );
      log({ msg: `Catalog: ${e.message}`, level: 'warn' });
    }
  });

  function formatGatt(rows) {
    const lines = [];
    for (const s of rows) {
      const short = s.uuid;
      const tag =
        short.includes('ae00') || short.startsWith('0000ae00')
          ? ' ← JieLi OTA'
          : short.includes('7e400001')
            ? ' ← UART'
            : short.includes('180a')
              ? ' ← DIS'
              : short.includes('180f')
                ? ' ← Battery'
                : '';
      lines.push(`Service ${short}${tag}`);
      for (const c of s.characteristics) {
        lines.push(`  ${c.uuid}  [${c.properties.join(', ')}]`);
      }
    }
    const hasOta = rows.some((s) => s.uuid.toLowerCase().includes('ae00'));
    const hasUart = rows.some((s) => s.uuid.toLowerCase().includes('7e400001'));
    lines.push('');
    lines.push(`JieLi OTA AE00: ${hasOta ? 'YES' : 'NO'}`);
    lines.push(`UART 7E40…:     ${hasUart ? 'YES' : 'NO'}`);
    return lines.join('\n');
  }

  $('#btnProbeGatt').addEventListener('click', async () => {
    try {
      const server = client.getActiveGattServer();
      if (!server?.connected) throw new Error('No active GATT connection');
      const rows = await listGattSummary(server);
      $('#gattProbeOut').textContent = formatGatt(rows);
      log({ msg: `GATT probe: ${rows.length} services`, level: 'ok' });
      toast('GATT probed', 'ok');
    } catch (e) {
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    }
  });

  async function pickerConnectOta() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [JIELI_OTA.SERVICE] },
        { services: [GATT.SERVICE] },
        { namePrefix: 'BJ' },
        { namePrefix: 'DG' },
      ],
      optionalServices: [JIELI_OTA.SERVICE, GATT.SERVICE, GATT.BATTERY_SERVICE, GATT.DIS_SERVICE],
    });
    const server = await device.gatt.connect();
    return { device, server };
  }

  $('#btnProbeOtaPicker').addEventListener('click', async () => {
    try {
      const { device, server } = await pickerConnectOta();
      log({ msg: `OTA picker: ${device.name || device.id}`, level: 'info' });
      const rows = await listGattSummary(server);
      $('#gattProbeOut').textContent = formatGatt(rows);
      toast('Probed via picker', 'ok');
      // leave connected for possible flash — user may disconnect elsewhere
    } catch (e) {
      if (e.name === 'NotFoundError') return;
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    }
  });

  async function flashWithServer(server) {
    if (!otaPkg?.ufwBytes?.length) throw new Error('Prepare or load a UFW package first');
    if (!$('#otaConfirmRisk').checked) throw new Error('Confirm the brick-risk checkbox first');
    if (flashing) throw new Error('OTA already running');
    flashing = true;
    const wrap = $('#otaFlashProgress');
    const bar = $('#otaFlashBar');
    wrap.hidden = false;
    bar.style.width = '0%';
    try {
      const { writeChar, notifyChar } = await findJieliOtaChars(server);
      log({
        msg: `OTA flash start ${otaPkg.ufwName} (${otaPkg.ufwBytes.length} B)`,
        level: 'warn',
      });
      const result = await runJieliOta(writeChar, notifyChar, otaPkg.ufwBytes, {
        onLog: (m) => log({ msg: `[OTA] ${m}`, level: 'info' }),
        onProgress: (p) => {
          bar.style.width = `${p}%`;
        },
      });
      toast(result.ok ? 'OTA complete' : 'OTA finished (verify unclear)', result.ok ? 'ok' : 'err');
      flashMeta().textContent = result.ok ? 'Flash complete — device may reboot' : 'Flash done — verify unclear';
    } finally {
      flashing = false;
      setTimeout(() => {
        wrap.hidden = true;
      }, 800);
    }
  }

  $('#btnOtaFlash').addEventListener('click', async () => {
    try {
      const server = client.getActiveGattServer();
      if (!server?.connected) throw new Error('Connect a badge first (or use Picker + flash)');
      await flashWithServer(server);
    } catch (e) {
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    }
  });

  $('#btnOtaFlashPicker').addEventListener('click', async () => {
    try {
      if (!otaPkg?.ufwBytes?.length) throw new Error('Prepare or load a UFW package first');
      if (!$('#otaConfirmRisk').checked) throw new Error('Confirm the brick-risk checkbox first');
      const { device, server } = await pickerConnectOta();
      log({ msg: `OTA flash picker → ${device.name || device.id}`, level: 'warn' });
      await flashWithServer(server);
    } catch (e) {
      if (e.name === 'NotFoundError') return;
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    }
  });

  $('#btnAdvHandshake').addEventListener('click', () =>
    client
      .fitProHandshake()
      .then(() => toast('Legacy 0x1A probes sent', 'ok'))
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnAdvPair').addEventListener('click', () =>
    client
      .pair()
      .then(() => toast('Pair frame sent', 'ok'))
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnAdvDialInfo').addEventListener('click', () => {
    if (!confirm('Dial-info (0x20) often disconnects BJ-1. Continue?')) return;
    client
      .refreshDialInfo({ timeoutMs: 6000 })
      .then((info) => {
        toast(`Dial ${info.width}×${info.height} alg=${info.algorithm}`, 'ok');
        const snap = client.getSnapshot?.() || {};
        const capture = {
          capturedAt: new Date().toISOString(),
          source: 'web-console-advanced',
          name: snap.name || null,
          dialInfo: info,
          dis: {
            model: snap.model ?? null,
            firmware: snap.firmware ?? null,
            hardware: snap.hardware ?? null,
          },
          battery: snap.battery ?? null,
        };
        const blob = new Blob([JSON.stringify(capture, null, 2) + '\n'], {
          type: 'application/json',
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `dial-info_${(capture.name || 'badge').replace(/\W+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        log({ msg: `Dial-info capture downloaded (alg=${info.algorithm} ${info.width}×${info.height})`, level: 'ok' });
      })
      .catch((e) => toast(e.message, 'err'));
  });

  // Populate preset select labels from catalog module
  const sel = $('#otaPreset');
  if (sel && !sel.dataset.filled) {
    sel.innerHTML = '';
    for (const p of Object.values(OTA_PRESETS)) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      sel.appendChild(opt);
    }
    sel.dataset.filled = '1';
  }
  sel?.addEventListener('change', () => {
    const p = OTA_PRESETS[sel.value];
    if (!p) return;
    $('#otaCatVersion').value = p.catalogVersion;
    $('#otaCatName').value = p.name;
  });
}
