import assert from 'node:assert/strict';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { acceptTimestamp, jpegToRgb, parseFrame } from '../src/frames.js';

test('parseFrame reads a big-endian timestamp and the jpeg tail', () => {
  const jpegBytes = Buffer.alloc(90, 7);
  const packet = Buffer.alloc(8 + jpegBytes.length);
  packet.writeDoubleBE(1_500_000, 0);
  jpegBytes.copy(packet, 8);
  const frame = parseFrame(packet);
  assert.ok(frame);
  assert.equal(frame?.timestampUs, 1_500_000);
  assert.equal(frame?.jpeg.length, jpegBytes.length);
});

test('parseFrame rejects short and non-finite timestamps', () => {
  assert.equal(parseFrame(Buffer.alloc(10)), null);
  const bad = Buffer.alloc(100);
  bad.writeDoubleBE(Number.NaN, 0);
  assert.equal(parseFrame(bad), null);
});

test('timestamps must move forward', () => {
  assert.equal(acceptTimestamp(1000, 2000), true);
  assert.equal(acceptTimestamp(2000, 2000), false);
  assert.equal(acceptTimestamp(2000, 1500), false);
});

test('jpegToRgb returns packed RGB', async () => {
  const width = 160;
  const height = 120;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = 10;
    data[i * 4 + 1] = 20;
    data[i * 4 + 2] = 30;
    data[i * 4 + 3] = 255;
  }
  const encoded = jpeg.encode({ data, width, height }, 90);
  const frame = await jpegToRgb(Buffer.from(encoded.data));
  assert.ok(frame);
  assert.equal(frame?.width, width);
  assert.equal(frame?.height, height);
  assert.equal(frame?.rgb.length, width * height * 3);
  assert.notEqual(frame?.rgb.length, width * height * 4);
  assert.ok((frame?.rgb[0] ?? 255) < 40);
  assert.ok((frame?.rgb[1] ?? 0) > 5);
});
