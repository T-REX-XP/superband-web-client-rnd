/**
 * Extras tab: live viewfinder (remote camera) + quick device actions.
 *
 * Live viewfinder uses product 0x27 (see ./preview.js): the host streams JPEG
 * frames from its camera to the badge display. Implemented with getUserMedia +
 * canvas.toBlob; each frame is wrapped as `AA BB CC DD EE FF | u32BE(len) |
 * jpeg | FF EE DD CC BB AA` and chunked into GATT writes.
 *
 * Quick actions are the legacy MyWatch settings/device-control frames built in
 * ./commands.js (sync time, find, goals, remote shutter, OTA mode, reset …).
 */

import { PREVIEW } from './preview.js';
import { DeviceControlKey } from './commands.js';

/**
 * @param {{ client: import('./client.js').SuperBandClient, log: Function, toast: Function, $: Function }} ctx
 */
export function bindExtras(ctx) {
  const { client, log, toast, $ } = ctx;

  // ── Live viewfinder ───────────────────────────────────────────────────────
  const video = $('#liveVideo');
  const canvas = $('#liveCanvas');
  const ctx2d = canvas?.getContext('2d', { willReadFrequently: false }) || null;

  let stream = null;
  let running = false;
  let starting = false;
  let previewSession = null;
  let streamToken = null;
  let frames = 0;
  let startedAt = 0;
  let lastStatsAt = 0;
  let latestDims = { width: PREVIEW.DEFAULT_WIDTH, height: PREVIEW.DEFAULT_HEIGHT };

  const testPattern = () => $('#liveTestPattern')?.checked ?? false;
  const autoStart = () => $('#liveAutoStart')?.checked ?? false;
  const fpsTarget = () => clamp(Number($('#liveFps')?.value) || PREVIEW.DEFAULT_FPS, 1, 30);
  const quality = () => clamp(Number($('#liveQuality')?.value) || PREVIEW.DEFAULT_QUALITY, 0.1, 0.95);
  const chunkSize = () => clamp(Number($('#liveChunk')?.value) || PREVIEW.DEFAULT_CHUNK, 20, 512);

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  const LIVE_SETTINGS_KEY = 'superband.live.settings';

  function loadLiveSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(LIVE_SETTINGS_KEY) || 'null');
      if (!s) return;
      if (s.fps != null && $('#liveFps')) $('#liveFps').value = s.fps;
      if (s.quality != null && $('#liveQuality')) $('#liveQuality').value = s.quality;
      if (s.chunk != null && $('#liveChunk')) $('#liveChunk').value = s.chunk;
      if (s.testPattern != null && $('#liveTestPattern')) $('#liveTestPattern').checked = !!s.testPattern;
      if (s.autoStart != null && $('#liveAutoStart')) $('#liveAutoStart').checked = !!s.autoStart;
    } catch {
      /* ignore malformed settings */
    }
  }

  function saveLiveSettings() {
    try {
      localStorage.setItem(
        LIVE_SETTINGS_KEY,
        JSON.stringify({
          fps: $('#liveFps')?.value,
          quality: $('#liveQuality')?.value,
          chunk: $('#liveChunk')?.value,
          testPattern: testPattern(),
          autoStart: autoStart(),
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }

  function setLiveMeta(text, state = '') {
    const el = $('#liveMeta');
    if (!el) return;
    el.textContent = text;
    if (state) el.dataset.state = state;
    else delete el.dataset.state;
  }

  function updateLiveButtons() {
    const on = client.connected && client.getSnapshot().protocolMode === 'fitpro';
    const active = running || client.previewActive;
    if ($('#btnLiveStart')) $('#btnLiveStart').disabled = !on || running || starting;
    if ($('#btnLiveStop')) $('#btnLiveStop').disabled = !active;
    if ($('#btnLiveCamera')) $('#btnLiveCamera').disabled = !on || running || starting;
  }

  async function ensureCamera() {
    if (stream) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia unavailable (needs HTTPS)');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 640 } },
      audio: false,
    });
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play().catch(() => {});
    log({ msg: 'Camera ready', level: 'ok' });
    return true;
  }

  function stopCamera() {
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  function drawCover(w, h) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;
    const scale = Math.max(w / vw, h / vh);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    ctx2d.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    return true;
  }

  function drawTestPattern(w, h, n) {
    const t = (performance.now() / 1000) % 1;
    const g = ctx2d.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${(t * 360) | 0} 80% 45%)`);
    g.addColorStop(1, `hsl(${((t * 360 + 120) | 0) % 360} 80% 25%)`);
    ctx2d.fillStyle = g;
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.fillStyle = '#fff';
    ctx2d.font = `${Math.round(h / 10)}px system-ui, sans-serif`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(`#${n}`, w / 2, h / 2 - h / 12);
    ctx2d.font = `${Math.round(h / 20)}px system-ui, sans-serif`;
    ctx2d.fillText(new Date().toLocaleTimeString(), w / 2, h / 2 + h / 10);
    return true;
  }

  function canvasToJpeg(w, h) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('canvas.toBlob failed'));
            return;
          }
          blob
            .arrayBuffer()
            .then((buf) => resolve(new Uint8Array(buf)))
            .catch(reject);
        },
        'image/jpeg',
        quality(),
      );
    });
  }

  function renderStats() {
    const el = $('#liveStats');
    if (!el) return;
    const secs = startedAt ? (performance.now() - startedAt) / 1000 : 0;
    const fps = secs > 0 && frames > 1 ? ((frames - 1) / secs).toFixed(1) : '0.0';
    el.textContent = `frames=${frames} avg=${fps}fps target=${fpsTarget()}fps`;
  }

  async function loop(token, session) {
    if (streamToken !== token) return;
    const started = performance.now();
    try {
      const w = latestDims.width;
      const h = latestDims.height;
      const drew = testPattern() ? drawTestPattern(w, h, frames + 1) : drawCover(w, h);
      if (drew) {
        const jpeg = await canvasToJpeg(w, h);
        if (streamToken === token) {
          await session.previewSendFrame(jpeg, { chunkSize: chunkSize() });
          frames++;
        }
      }
    } catch (e) {
      if (streamToken === token) {
        log({ msg: `Live frame failed: ${e.message}`, level: 'err' });
        await stopPreview({ respond: false, quiet: true });
        toast(e.message, 'err');
      }
    }
    if (performance.now() - lastStatsAt > 500) {
      lastStatsAt = performance.now();
      renderStats();
    }
    if (streamToken !== token) return;
    const dt = performance.now() - started;
    const wait = Math.max(0, 1000 / fpsTarget() - dt);
    setTimeout(() => loop(token, session), wait);
  }

  function beginStreaming(dims, session) {
    latestDims = {
      width: clamp(Number(dims?.width) || PREVIEW.DEFAULT_WIDTH, 16, 1024),
      height: clamp(Number(dims?.height) || PREVIEW.DEFAULT_HEIGHT, 16, 1024),
    };
    canvas.width = latestDims.width;
    canvas.height = latestDims.height;
    frames = 0;
    startedAt = performance.now();
    lastStatsAt = 0;
    running = true;
    previewSession = session;
    streamToken = Symbol('preview');
    updateLiveButtons();
    setLiveMeta(
      `Streaming ${latestDims.width}×${latestDims.height} ${testPattern() ? '(test pattern)' : '(camera)'}`,
      'ok',
    );
    renderStats();
    loop(streamToken, session);
  }

  async function startPreview() {
    if (running || starting) return;
    const session = client.active;
    if (!session?.connected || session.protocolMode !== 'fitpro') {
      toast('Connect a badge first', 'err');
      return;
    }
    starting = true;
    updateLiveButtons();
    try {
      let dims;
      if (!testPattern()) await ensureCamera();
      if (client.active !== session) throw new Error('The active badge changed. Start the viewfinder again.');
      const snap = session.getSnapshot();
      if (session.previewActive && snap.previewWidth) {
        // Badge already started the viewfinder — do not send START again.
        dims = { width: snap.previewWidth, height: snap.previewHeight };
      } else {
        dims = await session.previewStart({ timeoutMs: 6000 });
      }
      if (client.active !== session) {
        await session.previewStop();
        throw new Error('The active badge changed. Start the viewfinder again.');
      }
      beginStreaming(dims, session);
    } catch (e) {
      stopCamera();
      setLiveMeta(e.message, 'err');
      toast(e.message, 'err');
      log({ msg: `Live preview: ${e.message}`, level: 'err' });
    } finally {
      starting = false;
      updateLiveButtons();
    }
  }

  async function stopPreview({ respond = false, quiet = false } = {}) {
    const session = previewSession || client.active;
    const wasActive = respond || running || session?.previewActive;
    running = false;
    streamToken = null;
    previewSession = null;
    stopCamera();
    if (!wasActive) {
      updateLiveButtons();
      return;
    }
    try {
      await session.previewStop({ respond });
    } catch (e) {
      if (!quiet) log({ msg: `Stop preview: ${e.message}`, level: 'warn' });
    }
    setLiveMeta('Idle', '');
    updateLiveButtons();
    renderStats();
  }

  $('#btnLiveCamera')?.addEventListener('click', () =>
    ensureCamera()
      .then(() => setLiveMeta('Camera ready — press Start', 'ok'))
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnLiveStart')?.addEventListener('click', () => startPreview());
  $('#btnLiveStop')?.addEventListener('click', () => stopPreview({ respond: false }));
  $('#liveTestPattern')?.addEventListener('change', () => {
    if (!testPattern()) stopCamera();
    saveLiveSettings();
  });
  $('#liveAutoStart')?.addEventListener('change', saveLiveSettings);
  for (const id of ['#liveFps', '#liveQuality', '#liveChunk']) {
    $(id)?.addEventListener('change', saveLiveSettings);
  }

  // Device asked us to start/stop (badge opened/closed its camera UI).
  client.addEventListener('preview', (e) => {
    if (e.detail?.sessionId !== client.activeId) return;
    const phase = e.detail?.phase;
    if (phase === 'device-start') {
      log({
        msg: `Badge requested viewfinder (${e.detail.width}×${e.detail.height})`,
        level: 'ok',
      });
      if (autoStart()) {
        startPreview();
      } else {
        setLiveMeta('Badge requested viewfinder — press Start to stream', 'busy');
        updateLiveButtons();
      }
    } else if (phase === 'device-end') {
      log({ msg: 'Badge requested preview stop', level: 'info' });
      stopPreview({ respond: true });
    } else if (phase === 'stopped') {
      running = false;
      streamToken = null;
      previewSession = null;
      stopCamera();
      updateLiveButtons();
    }
  });

  client.addEventListener('connection', () => {
    updateLiveButtons();
    if (previewSession && previewSession !== client.active) stopPreview({ respond: false });
  });
  client.addEventListener('sessions', () => updateLiveButtons());

  // Stop the camera when the tab/page is hidden or closed.
  window.addEventListener('pagehide', () => stopCamera());

  // ── Quick actions ─────────────────────────────────────────────────────────
  const qa = async (label, fn) => {
    if (!client.connected) {
      toast('Connect a badge first', 'err');
      return;
    }
    try {
      await fn();
      toast(`${label} sent`, 'ok');
      log({ msg: `Quick action: ${label}`, level: 'ok' });
    } catch (e) {
      toast(e.message, 'err');
      log({ msg: `${label}: ${e.message}`, level: 'err' });
    }
  };

  const QA_ACTIONS = {
    syncTime: () => qa('Sync time', () => client.syncTime(new Date())),
    findOn: () => qa('Find device ON', () => client.findDevice(true)),
    findOff: () => qa('Find device OFF', () => client.findDevice(false)),
    setGoal: () =>
      qa('Set step goal', () => client.setStepTarget(Number($('#qaGoalSteps')?.value) || 10000)),
    setUserInfo: () =>
      qa('Set user info', () =>
        client.setUserInfo({
          sex: Number($('#qaSex')?.value) || 0,
          age: Number($('#qaAge')?.value) || 30,
          heightCm: Number($('#qaHeight')?.value) || 170,
          weightKg: Number($('#qaWeight')?.value) || 70,
        }),
      ),
    realtimeStepOn: () => qa('Realtime step ON', () => client.setRealtimeStep(true)),
    realtimeStepOff: () => qa('Realtime step OFF', () => client.setRealtimeStep(false)),
    takePhotoOn: () => qa('Remote photo page ON', () => client.takePhoto(true)),
    takePhotoOff: () => qa('Remote photo page OFF', () => client.takePhoto(false)),
    otaMode: () => {
      if (!confirm('Enter firmware-update (OTA) mode on the badge?')) return;
      qa('Enter OTA mode', () => client.enterOtaMode());
    },
    shutdown: () => {
      if (!confirm('Power off the badge?')) return;
      qa('Shutdown', () => client.shutdown());
    },
    reset: () => {
      if (!confirm('Factory reset the badge? This can erase settings.')) return;
      qa('Device reset', () => client.deviceReset());
    },
  };

  const DC_ACTIONS = {
    findPhone: DeviceControlKey.FindPhone,
    stopFindPhone: DeviceControlKey.StopFindPhone,
    takePhoto: DeviceControlKey.TakePhoto,
    openCamera: DeviceControlKey.OpenCamera,
    exitCamera: DeviceControlKey.ExitCamera,
    answerPhone: DeviceControlKey.AnswerPhone,
    hangUp: DeviceControlKey.HangUp,
  };

  document.querySelectorAll('[data-qa]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.qa;
      if (QA_ACTIONS[key]) QA_ACTIONS[key]();
    });
  });

  document.querySelectorAll('[data-dc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = DC_ACTIONS[btn.dataset.dc];
      if (key != null) qa(`Device control ${btn.dataset.dc}`, () => client.deviceControl(key));
    });
  });

  window.addEventListener('pagehide', () => stopPreview({ respond: false, quiet: true }));
  loadLiveSettings();
  updateLiveButtons();
  renderStats();
}
