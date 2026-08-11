/**
 * JieLi RCSP BLE OTA over AE00/AE01/AE02.
 * Ported from openwearota drivers/jieli.py (alpha — AC707N best-effort).
 */

export const JIELI_OTA = {
  SERVICE: '0000ae00-0000-1000-8000-00805f9b34fb',
  WRITE: '0000ae01-0000-1000-8000-00805f9b34fb',
  NOTIFY: '0000ae02-0000-1000-8000-00805f9b34fb',
};

const PREFIX = new Uint8Array([0xfe, 0xdc, 0xba]);
const END = 0xef;

export const RcspCmd = {
  GET_TARGET_INFO: 0x03,
  OTA_GET_OFFSET: 0xe1,
  OTA_INQUIRE: 0xe2,
  OTA_ENTER: 0xe3,
  OTA_EXIT: 0xe4,
  OTA_SEND_BLOCK: 0xe5,
  OTA_REFRESH: 0xe6,
  REBOOT: 0xe7,
  OTA_NOTIFY_SIZE: 0xe8,
};

function u16LE(n) {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}

function u32LE(n) {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}

function readU32LE(buf, o = 0) {
  return (
    (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
  );
}

function readU16LE(buf, o = 0) {
  return buf[o] | (buf[o + 1] << 8);
}

export function buildRcspFrame(opcode, payload, sn) {
  const pl = payload instanceof Uint8Array ? payload : new Uint8Array(payload || 0);
  const inner = new Uint8Array(2 + pl.length);
  inner[0] = sn & 0xff;
  inner[1] = opcode & 0xff;
  inner.set(pl, 2);
  const out = new Uint8Array(3 + 2 + inner.length + 1);
  out.set(PREFIX, 0);
  out[3] = inner.length & 0xff;
  out[4] = (inner.length >> 8) & 0xff;
  out.set(inner, 5);
  out[5 + inner.length] = END;
  return out;
}

export function parseRcspFrame(buf) {
  if (buf.length < 7) throw new Error('RCSP frame too short');
  if (buf[0] !== 0xfe || buf[1] !== 0xdc || buf[2] !== 0xba) {
    throw new Error('Bad RCSP prefix');
  }
  const length = buf[3] | (buf[4] << 8);
  if (buf.length < 5 + length + 1) throw new Error('RCSP incomplete');
  if (buf[5 + length] !== END) throw new Error('Bad RCSP end');
  const body = buf.slice(5, 5 + length);
  return { sn: body[0], opcode: body[1], status: body[2], payload: body.slice(3) };
}

/**
 * @param {BluetoothRemoteGATTCharacteristic} writeChar
 * @param {BluetoothRemoteGATTCharacteristic} notifyChar
 * @param {Uint8Array} firmware
 * @param {{ onLog?: Function, onProgress?: Function }} opts
 */
export async function runJieliOta(writeChar, notifyChar, firmware, opts = {}) {
  const log = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  let sn = 0;
  /** @type {Uint8Array[]} */
  const queue = [];
  let waitResolve = null;

  const onValue = (ev) => {
    const v = new Uint8Array(ev.target.value.buffer);
    queue.push(v);
    if (waitResolve) {
      const r = waitResolve;
      waitResolve = null;
      r();
    }
  };

  await notifyChar.startNotifications();
  notifyChar.addEventListener('characteristicvaluechanged', onValue);

  const waitNotify = (timeoutMs = 10000) =>
    new Promise((resolve, reject) => {
      if (queue.length) {
        resolve();
        return;
      }
      const t = setTimeout(() => {
        waitResolve = null;
        reject(new Error('Timeout waiting for RCSP notify'));
      }, timeoutMs);
      waitResolve = () => {
        clearTimeout(t);
        resolve();
      };
    });

  const send = async (opcode, payload = new Uint8Array(0)) => {
    const frame = buildRcspFrame(opcode, payload, sn);
    sn = (sn + 1) & 0xff;
    const props = writeChar.properties;
    if (props.write) {
      await writeChar.writeValueWithResponse(frame);
    } else {
      await writeChar.writeValueWithoutResponse(frame);
    }
    await waitNotify(12000);
    const raw = queue.shift();
    return parseRcspFrame(raw);
  };

  try {
    log('RCSP GET_TARGET_INFO…');
    const info = await send(RcspCmd.GET_TARGET_INFO);
    if (info.payload?.length > 1) {
      const n = info.payload[0];
      const name = new TextDecoder().decode(info.payload.slice(1, 1 + n));
      log(`Device name: ${name}`);
    }

    log('RCSP OTA_INQUIRE…');
    const inquire = await send(RcspCmd.OTA_INQUIRE);
    if (inquire.payload?.length && inquire.payload[0] !== 0) {
      await send(RcspCmd.OTA_EXIT).catch(() => {});
      throw new Error(`OTA refused (reason ${inquire.payload[0]}) — battery / busy / auth?`);
    }

    log('RCSP OTA_ENTER…');
    const enter = await send(RcspCmd.OTA_ENTER);
    if (!enter.payload?.length || enter.payload[0] !== 1) {
      throw new Error('Failed to enter OTA mode (device may require RCSP auth)');
    }

    const total = firmware.length;
    log(`Notify size ${total} bytes…`);
    await send(RcspCmd.OTA_NOTIFY_SIZE, concat(u32LE(total), u32LE(0)));

    log('GET_OFFSET…');
    const offRsp = await send(RcspCmd.OTA_GET_OFFSET);
    let offset = offRsp.payload.length >= 4 ? readU32LE(offRsp.payload, 0) : 0;
    let chunkSize = offRsp.payload.length >= 6 ? readU16LE(offRsp.payload, 4) : 128;
    chunkSize = Math.min(Math.max(chunkSize, 16), 180);
    if (offset) log(`Resume offset ${offset}`);
    log(`Streaming chunk=${chunkSize}…`);

    while (offset < total) {
      const chunk = firmware.subarray(offset, offset + chunkSize);
      const rsp = await send(RcspCmd.OTA_SEND_BLOCK, concat(u32LE(offset), chunk));
      if (rsp.payload.length >= 4) {
        const confirmed = readU32LE(rsp.payload, 0);
        if (confirmed !== offset + chunk.length) {
          offset = confirmed;
          onProgress(Math.round((offset / total) * 100));
          continue;
        }
      }
      offset += chunk.length;
      onProgress(Math.round((offset / total) * 100));
    }

    log('Waiting verification (REFRESH)…');
    let ok = false;
    for (let i = 0; i < 30; i++) {
      const r = await send(RcspCmd.OTA_REFRESH);
      if (r.payload?.length && r.payload[0] !== 0) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    log('Reboot…');
    await send(RcspCmd.REBOOT, new Uint8Array([0]));
    try {
      await send(RcspCmd.OTA_EXIT);
    } catch {
      /* device may already reboot */
    }
    onProgress(100);
    log(ok ? 'JieLi OTA complete' : 'JieLi OTA finished (verify unclear)');
    return { ok, size: total };
  } finally {
    try {
      notifyChar.removeEventListener('characteristicvaluechanged', onValue);
      await notifyChar.stopNotifications();
    } catch {
      /* ignore */
    }
  }
}

function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Discover JieLi OTA chars on an open GATT server.
 * @param {BluetoothRemoteGATTServer} server
 */
export async function findJieliOtaChars(server) {
  const svc = await server.getPrimaryService(JIELI_OTA.SERVICE);
  const writeChar = await svc.getCharacteristic(JIELI_OTA.WRITE);
  const notifyChar = await svc.getCharacteristic(JIELI_OTA.NOTIFY);
  return { service: svc, writeChar, notifyChar };
}

export async function listGattSummary(server) {
  const services = await server.getPrimaryServices();
  const rows = [];
  for (const s of services) {
    const chars = await s.getCharacteristics();
    rows.push({
      uuid: s.uuid,
      characteristics: chars.map((c) => ({
        uuid: c.uuid,
        properties: Object.entries(c.properties)
          .filter(([, v]) => v)
          .map(([k]) => k),
      })),
    });
  }
  return rows;
}
