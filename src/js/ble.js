import {
  GATT,
  PacketAssembler,
  buildPairingFrame,
  describePacket,
  toHex,
} from './protocol.js';
import { JIELI_OTA } from './jieli-ota.js';

function decodeDisString(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0xff)) end -= 1;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, end)).trim();
}

/**
 * Web Bluetooth transport for SuperBand UART GATT.
 */
export class SuperBandBle {
  constructor({ onPacket, onLog, onConnectionChange } = {}) {
    this.device = null;
    this.server = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.assembler = new PacketAssembler();
    this.onPacket = onPacket || (() => {});
    this.onLog = onLog || (() => {});
    this.onConnectionChange = onConnectionChange || (() => {});
    this._boundDisconnect = () => this._handleDisconnect();
    this.writeQueue = Promise.resolve();
    this.disInfo = null;
  }

  get connected() {
    return !!(this.device?.gatt?.connected && this.writeChar);
  }

  /** Open GATT server (may be connected without UART chars during OTA-only use). */
  get gattServer() {
    return this.server || this.device?.gatt || null;
  }

  log(msg, level = 'info') {
    this.onLog({ msg, level, ts: Date.now() });
  }

  static supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async connect({ acceptAll = false } = {}) {
    if (!SuperBandBle.supported()) {
      throw new Error('Web Bluetooth is not available. Use Chromium on HTTPS or localhost.');
    }

    const optionalServices = [
      GATT.SERVICE,
      GATT.BATTERY_SERVICE,
      GATT.DIS_SERVICE,
      JIELI_OTA.SERVICE,
    ];

    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices }
      : {
          filters: [
            { services: [GATT.SERVICE] },
            { manufacturerData: [{ companyIdentifier: 0xaa01 }] },
            { namePrefix: '_V' },
            { namePrefix: 'BJ' },
            { namePrefix: 'DG' },
            { namePrefix: 'SuperBand' },
          ],
          optionalServices,
        };

    this.log(
      acceptAll
        ? 'Picker: all devices'
        : 'Picker: badge filters (UART / mfg 0xAA01 / BJ* / DG* / _V*)',
    );
    this.device = await navigator.bluetooth.requestDevice(options);
    this.device.addEventListener('gattserverdisconnected', this._boundDisconnect);
    this.log(`Selected: ${this.device.name || '(no name)'} [${this.device.id}]`);

    this.server = await this.device.gatt.connect();
    this.log('GATT connected — discovering UART…');

    let service;
    try {
      service = await this.server.getPrimaryService(GATT.SERVICE);
    } catch {
      const services = await this.server.getPrimaryServices();
      const match = services.find((s) => s.uuid.toLowerCase().startsWith('7e40'));
      if (!match) {
        throw new Error(
          `UART service ${GATT.SERVICE} not found. Services: ${services.map((s) => s.uuid).join(', ')}`,
        );
      }
      service = match;
      this.log(`Using UART-like service ${service.uuid}`, 'warn');
    }

    this.writeChar = await service.getCharacteristic(GATT.WRITE);
    this.notifyChar = await service.getCharacteristic(GATT.NOTIFY);
    this.assembler.reset();

    await this.notifyChar.startNotifications();
    this.notifyChar.addEventListener('characteristicvaluechanged', (ev) => {
      const value = new Uint8Array(ev.target.value.buffer);
      this.log(`← notify ${value.length}B  ${toHex(value)}`, 'rx');
      const packets = this.assembler.push(value);
      for (const pkt of packets) {
        if (!pkt || pkt.incomplete) continue;
        this.log(`← ${describePacket(pkt)}`, 'rx');
        this.onPacket(pkt);
      }
    });

    this.onConnectionChange(true, {
      id: this.device.id,
      name: this.device.name || null,
    });
    this.log('Notify enabled on 7E400003');

    try {
      await this.write(buildPairingFrame(), 'legacy pair');
      // Let firmware settle before Baji system/media traffic (BJ-1 often only ACKs with 0xDC).
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      this.log(`Pair frame failed: ${e.message}`, 'warn');
    }

    return this.device;
  }

  async write(data, label = 'write') {
    if (!this.writeChar) throw new Error('Not connected');
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.writeQueue = this.writeQueue.then(async () => {
      this.log(`→ ${label} ${bytes.length}B  ${toHex(bytes)}`, 'tx');
      const props = this.writeChar.properties;
      if (props.writeWithoutResponse) {
        await this.writeChar.writeValueWithoutResponse(bytes);
      } else {
        await this.writeChar.writeValueWithResponse(bytes);
      }
      await new Promise((r) => setTimeout(r, 8));
    });
    return this.writeQueue;
  }

  async readBattery() {
    try {
      const svc = await this.server.getPrimaryService(GATT.BATTERY_SERVICE);
      const ch = await svc.getCharacteristic(GATT.BATTERY_LEVEL);
      const v = await ch.readValue();
      // Some firmwares return multi-octet values; first byte is still %.
      return v.getUint8(0);
    } catch {
      return null;
    }
  }

  /**
   * Read Device Information Service strings (works even when Baji DEVICE_INFO is absent).
   */
  async readDeviceInformation() {
    const out = {
      model: null,
      serial: null,
      firmware: null,
      hardware: null,
      software: null,
      manufacturer: null,
    };
    try {
      const svc = await this.server.getPrimaryService(GATT.DIS_SERVICE);
      const map = [
        ['model', GATT.DIS_MODEL],
        ['serial', GATT.DIS_SERIAL],
        ['firmware', GATT.DIS_FIRMWARE],
        ['hardware', GATT.DIS_HARDWARE],
        ['software', GATT.DIS_SOFTWARE],
        ['manufacturer', GATT.DIS_MANUFACTURER],
      ];
      for (const [key, uuid] of map) {
        try {
          const ch = await svc.getCharacteristic(uuid);
          const v = await ch.readValue();
          const s = decodeDisString(v);
          if (s) out[key] = s;
        } catch {
          // characteristic absent — ignore
        }
      }
    } catch {
      this.log('DIS (0x180A) not available', 'warn');
    }
    this.disInfo = out;
    const summary = [
      out.model && `model=${out.model}`,
      out.firmware && `fw=${out.firmware}`,
      out.hardware && `hw=${out.hardware}`,
    ]
      .filter(Boolean)
      .join(' ');
    if (summary) this.log(`DIS: ${summary}`, 'ok');
    return out;
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this._cleanup({ notify: true });
  }

  /**
   * Drop local handles without calling GATT disconnect.
   * Used when a second picker result is the same BluetoothDevice as a live session.
   */
  abandon() {
    this._cleanup({ notify: false });
  }

  _handleDisconnect() {
    this.log('Disconnected', 'warn');
    this._cleanup({ notify: true });
  }

  _cleanup({ notify = true } = {}) {
    const meta = {
      id: this.device?.id || null,
      name: this.device?.name || null,
    };
    this.writeChar = null;
    this.notifyChar = null;
    this.server = null;
    this.disInfo = null;
    this.assembler.reset();
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this._boundDisconnect);
    }
    if (notify) this.onConnectionChange(false, meta);
  }
}
