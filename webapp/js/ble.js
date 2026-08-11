import {
  GATT,
  PacketAssembler,
  buildPairingFrame,
  describePacket,
  toHex,
} from './protocol.js';

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
  }

  get connected() {
    return !!(this.device?.gatt?.connected && this.writeChar);
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
      '0000180a-0000-1000-8000-00805f9b34fb',
    ];

    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices }
      : {
          filters: [
            { services: [GATT.SERVICE] },
            { namePrefix: '_V' },
            { manufacturerData: [{ companyIdentifier: 0xaa01 }] },
          ],
          optionalServices,
        };

    this.log(acceptAll ? 'Picker: all devices' : 'Picker: badge filters (service / name / mfg 0xAA01)');
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

    this.onConnectionChange(true);
    this.log('Notify enabled on 7E400003');

    // Best-effort MTU: Web Bluetooth does not expose requestMtu; Chrome negotiates automatically.
    try {
      await this.write(buildPairingFrame(), 'legacy pair');
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
      // Prefer writeWithoutResponse when available for throughput
      const props = this.writeChar.properties;
      if (props.writeWithoutResponse) {
        await this.writeChar.writeValueWithoutResponse(bytes);
      } else {
        await this.writeChar.writeValueWithResponse(bytes);
      }
      // Small pacing helps some firmwares
      await new Promise((r) => setTimeout(r, 8));
    });
    return this.writeQueue;
  }

  async readBattery() {
    try {
      const svc = await this.server.getPrimaryService(GATT.BATTERY_SERVICE);
      const ch = await svc.getCharacteristic(GATT.BATTERY_LEVEL);
      const v = await ch.readValue();
      return v.getUint8(0);
    } catch {
      return null;
    }
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this._cleanup();
  }

  _handleDisconnect() {
    this.log('Disconnected', 'warn');
    this._cleanup();
  }

  _cleanup() {
    this.writeChar = null;
    this.notifyChar = null;
    this.server = null;
    this.assembler.reset();
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this._boundDisconnect);
    }
    this.onConnectionChange(false);
  }
}
