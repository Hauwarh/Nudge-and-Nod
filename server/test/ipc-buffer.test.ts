import assert from 'node:assert/strict';
import test from 'node:test';
import { forkSdkChild } from '../src/sdk-host.js';

test('a JPEG buffer stays a Buffer across the sdk child ipc', async () => {
  const child = forkSdkChild();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4]);
  const reply = new Promise<{ isBuffer: boolean; length: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child did not answer')), 8000);
    child.on('message', (message: unknown) => {
      const body = message as { type?: string; isBuffer?: boolean; length?: number };
      if (body.type !== 'probe-frame') return;
      clearTimeout(timer);
      resolve({ isBuffer: Boolean(body.isBuffer), length: body.length ?? 0 });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  child.send({ type: 'probe-frame', jpeg, timestampUs: 1_000_000 });
  try {
    const result = await reply;
    assert.equal(result.isBuffer, true);
    assert.equal(result.length, jpeg.length);
  } finally {
    child.kill('SIGKILL');
  }
});
