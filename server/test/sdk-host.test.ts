import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BUSY_MESSAGE,
  guardedOpen,
  PRESAGE_UNREACHABLE,
  SdkHost,
  SdkStartupError,
  type SdkChild,
} from '../src/sdk-host.js';
import { isBenignSdkNoise, releaseSdk, sdkBusy } from '../src/sdk.js';

class FakeChild extends EventEmitter implements SdkChild {
  killed = false;
  sent: unknown[] = [];

  send(message: unknown): boolean {
    this.sent.push(message);
    const type = (message as { type?: string }).type;
    if (type === 'summary' || type === 'stop') {
      queueMicrotask(() =>
        this.emit('message', {
          type: 'summary',
          kept: null,
          coverage: null,
          trace: [],
          validationRatio: null,
        }),
      );
    }
    return true;
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 1, 'SIGKILL');
    return true;
  }
}

test('a silent sdk process is killed and the next check-in can start', async () => {
  const hung = new FakeChild();
  await assert.rejects(
    () =>
      guardedOpen('timeout-session', {
        apiKey: 'not-used',
        telemetry: false,
        startupTimeoutMs: 30,
        spawn: () => hung,
      }),
    (err: unknown) =>
      err instanceof SdkStartupError &&
      err.code === 'presage' &&
      err.message === PRESAGE_UNREACHABLE,
  );
  assert.equal(hung.killed, true);
  assert.equal(sdkBusy(), false);

  const next = new FakeChild();
  const opening = guardedOpen('after-timeout', {
    apiKey: 'not-used',
    telemetry: false,
    startupTimeoutMs: 200,
    spawn: () => next,
  });
  next.emit('message', { type: 'ready' });
  const host = await opening;
  assert.equal(sdkBusy(), true);
  await host.close();
  releaseSdk('after-timeout');
  assert.equal(sdkBusy(), false);
});

test('a key failure is shown and does not keep the lock', async () => {
  const fake = new FakeChild();
  const opening = guardedOpen('key-fail', {
    apiKey: 'not-used',
    telemetry: false,
    startupTimeoutMs: 200,
    spawn: () => fake,
  });
  queueMicrotask(() =>
    fake.emit('message', {
      type: 'failed',
      kind: 'presage',
      message: 'The Presage key was refused. Check the key on the server.',
    }),
  );
  await assert.rejects(
    () => opening,
    (err: unknown) =>
      err instanceof SdkStartupError &&
      err.code === 'presage' &&
      /key was refused/.test(err.message),
  );
  assert.equal(fake.killed, true);
  assert.equal(sdkBusy(), false);
});

test('a second check-in is told someone else is already in', async () => {
  const first = new FakeChild();
  const opening = guardedOpen('holder', {
    apiKey: 'not-used',
    telemetry: false,
    startupTimeoutMs: 200,
    spawn: () => first,
  });
  first.emit('message', { type: 'ready' });
  const host = await opening;
  const second = new FakeChild();
  await assert.rejects(
    () =>
      guardedOpen('other', {
        apiKey: 'not-used',
        telemetry: false,
        startupTimeoutMs: 50,
        spawn: () => second,
      }),
    (err: unknown) =>
      err instanceof SdkStartupError && err.code === 'busy' && err.message === BUSY_MESSAGE,
  );
  assert.equal(second.killed, false);
  await host.close();
  releaseSdk('holder');
});

test('healthz answers while the sdk process has not become ready', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nudge-health-'));
  const { app } = createApp({
    dataFile: path.join(dir, 'nudge.sqlite'),
    seed: false,
    config: loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      SEED_DEMO: 'false',
      SMARTSPECTRA_API_KEY: '',
    }),
  });
  const fake = new FakeChild();
  const host = new SdkHost({
    apiKey: 'not-used',
    telemetry: false,
    startupTimeoutMs: 400,
    spawn: () => fake,
  });
  const opening = host.open();
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  fake.emit('message', { type: 'ready' });
  await opening;
  await host.close();
});

test('vulkan and model-path notes are not household errors', () => {
  assert.equal(isBenignSdkNoise('phasic-bp-inference: Vulkan is not available'), true);
  assert.equal(
    isBenignSdkNoise('Unable to resolve configured model path. Falling back to remote delivery'),
    true,
  );
  assert.equal(isBenignSdkNoise('MediaPipe feedback tensor was empty'), true);
  assert.equal(isBenignSdkNoise('The Presage key was refused'), false);
});
