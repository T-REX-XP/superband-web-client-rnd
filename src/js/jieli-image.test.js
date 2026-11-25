import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { SuperBandBle } from './ble.js';
import { SuperBandClient } from './client.js';
import { buildFitProFrame, fitproByteSum } from './fitpro.js';
import { encodeBr35Etc2, encodePackedRgb565, inspectJieliResource } from './jieli-image.js';
import { PacketAssembler, parsePacket } from './protocol.js';

const solid = Uint8Array.from({ length: 360 * 360 * 4 }, (_, i) => [11, 83, 240, 255][i % 4]);
const noisy = Uint8Array.from({ length: solid.length }, (_, i) => (i * 73 + (i >> 8)) & 255);
const fixtures = [
  [1, 1, Uint8Array.of(255, 0, 0, 255), 1111, 'b07aea65a9d79eccf7ef27fc1d9ed4867a7db8ed589e437c3ef817eebda6a716'],
  [360, 360, solid, 5784, 'f830a2039464851d63cfb0ef1cb7d767c00a3fed7a1ca74061262111a52616b2'],
  [360, 360, noisy, 262824, '8570c287b74de094e06084a64236635dc5257576efdfd717cd6d9b68f207b265'],
];

test('packed images match SuperBand 2.1.25 ARMv7 mode 1 output', () => {
  for (const [width, height, rgba, length, hash] of fixtures) {
    const bytes = encodePackedRgb565(rgba, width, height);
    assert.equal(bytes.length, length);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
    assert.deepEqual(inspectJieliResource(bytes, 0), { width, height });
    bytes[bytes.length - 1] ^= 1;
    assert.equal(inspectJieliResource(bytes, 0), null);
  }
});

test('BR35 mode-6 resource declares an ETC2 RGBA8 block grid', () => {
  const bytes = encodeBr35Etc2(solid, 360, 360);
  assert.equal(bytes.length, 130704);
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RU50');
  assert.equal(Buffer.from(bytes.subarray(0x40, 0x50)).toString('hex'), '010090006801680140fa010050040000');
  assert.ok(bytes.subarray(0x450, 0x458).every((value, i) => value === (i === 0 ? 255 : 0)));
  assert.deepEqual(inspectJieliResource(bytes, 3), { width: 360, height: 360 });
  assert.equal(inspectJieliResource(bytes, 0), null);
  bytes[0x450] ^= 1;
  assert.equal(inspectJieliResource(bytes, 3), null);
});

test('BJ-1 sends a complete packed resource and accepts early notifications', async (t) => {
  const frames = [];
  t.mock.method(SuperBandBle.prototype, 'connect', async function () {
    this.device = { id: 'test-bj1', name: 'BJ-1', gatt: { connected: true } };
    this.writeChar = {};
  });
  t.mock.method(SuperBandBle.prototype, 'readBattery', async () => null);
  t.mock.method(SuperBandBle.prototype, 'readDeviceInformation', async () => ({}));
  t.mock.method(SuperBandBle.prototype, 'write', async function (bytes, label, options) {
    if (bytes[3] === 0x20 && bytes[5] === 2) {
      const fragments = [
        'cd00252001020020010001680168034b3636054c',
        '4a3733330703fffe01054a5130303100000961a8',
      ];
      const assembler = new PacketAssembler();
      for (const fragment of fragments) {
        for (const packet of assembler.push(Buffer.from(fragment, 'hex'))) this.onPacket(packet);
      }
    }
    if (bytes[3] !== 0x1f) return;
    assert.equal(options.atomic, true);
    assert.equal(options.paceMs, 6);
    assert.ok(bytes.length <= 512);
    const payload = Buffer.from(bytes.subarray(8));
    const command = bytes[5];
    frames.push({ command, payload });
    const status = command === 2 ? 1000 : command === 3 ? 2 : 1000 + payload.readUInt16BE();
    const reply = Buffer.alloc(4);
    reply.writeUInt32BE(status);
    this.onPacket(parsePacket(buildFitProFrame(0x20, 1, reply)));
  });

  const client = new SuperBandClient();
  const session = await client.connect();
  assert.equal(client.getSnapshot().dialAlgorithm, 3);
  assert.equal(session.dialInfo.shortPkgLength, 25000);
  await assert.rejects(client.transferFile(new Uint8Array(360 * 360 * 2)), /BR35 ETC2/);
  await assert.rejects(client.transferFile(encodePackedRgb565(solid, 360, 360)), /BR35 ETC2/);
  await assert.rejects(
    client.transferFile(encodeBr35Etc2(fixtures[0][2], 1, 1)),
    /requires a 360×360 image/,
  );
  assert.equal(frames.length, 0);

  const image = encodeBr35Etc2(solid, 360, 360);
  assert.equal((await client.transferFile(image)).verified, true);
  const [start, ...data] = frames;
  const finish = data.pop();
  assert.equal(start.command, 2);
  assert.equal(start.payload.readUInt32BE(), 5538);
  assert.equal(start.payload[4], 0);
  assert.equal(start.payload[5], 8);
  assert.equal(start.payload.readUInt32BE(9), image.length + 4);
  const blob = Buffer.concat(data.map(({ command, payload }, i) => {
    assert.equal(command, 1);
    assert.equal(payload.readUInt16BE(), i + 1);
    assert.equal(payload.readUInt32BE(payload.length - 4), fitproByteSum(payload.subarray(0, -4)));
    return payload.subarray(2, -4);
  }));
  assert.equal(blob.readUInt32BE(), image.length);
  assert.deepEqual(blob.subarray(4), Buffer.from(image));
  assert.equal(finish.command, 3);
  assert.equal(finish.payload.readUInt32BE(), fitproByteSum(blob));
});
