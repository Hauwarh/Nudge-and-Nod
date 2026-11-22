import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { resetRates } from '../src/rate-limit.js';
import { seedDemo } from '../src/seed.js';

function testApp(seed = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nudge-'));
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    SEED_DEMO: 'false',
    SMARTSPECTRA_API_KEY: '',
    SMARTSPECTRA_TELEMETRY: 'false',
    DATA_DIR: dir,
  });
  const built = createApp({
    config,
    dataFile: path.join(dir, 'nudge.sqlite'),
    seed,
  });
  return built;
}

test('healthz answers without touching the measurement', async () => {
  const { app } = testApp();
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('health is public and does not claim a key', async () => {
  const { app } = testApp();
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.keyConfigured, false);
  assert.equal(res.body.telemetry, false);
  assert.equal(typeof res.body.sdkPresent, 'boolean');
});

test('house, session, story, retention, and delete', async () => {
  resetRates();
  const { app, store } = testApp();
  const agent = request.agent(app);

  const anon = await agent.get('/api/me');
  assert.equal(anon.status, 401);

  const bad = await agent
    .post('/api/households')
    .send({ name: 'X', pin: '12', carerName: 'Sam', personName: 'June' });
  assert.equal(bad.status, 400);

  const created = await agent.post('/api/households').send({
    name: 'The Hart house',
    pin: '1357',
    carerName: 'Sam',
    personName: 'June',
  });
  assert.equal(created.status, 201);
  assert.match(created.body.household.code, /^[a-z]/);
  const june = created.body.members.find((member: { role: string }) => member.role === 'person');
  assert.ok(june);

  const me = await agent.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.household.name, 'The Hart house');
  assert.equal(me.body.disclaimer.includes('not a medical device'), true);

  const wrong = await request(app)
    .post('/api/session')
    .send({ code: created.body.household.code, pin: '0000' });
  assert.equal(wrong.status, 401);

  const added = await agent.post('/api/members').send({ displayName: 'Arthur' });
  assert.equal(added.status, 201);

  const consent = await agent
    .post('/api/consents')
    .send({ memberId: june.id, agreedAs: 'with_them', consenterName: 'Sam' });
  assert.equal(consent.status, 201);

  const stranger = testApp();
  const other = request.agent(stranger.app);
  await other.post('/api/households').send({
    name: 'Other',
    pin: '2468',
    carerName: 'Pat',
    personName: 'Lou',
  });
  const leaked = await other
    .post('/api/consents')
    .send({ memberId: june.id, agreedAs: 'self', consenterName: 'Pat' });
  assert.equal(leaked.status, 404);
  stranger.db.close();

  const started = new Date('2026-06-01T09:30:00.000Z').toISOString();
  for (let i = 0; i < 6; i += 1) {
    const at = new Date(Date.parse(started) + i * 86_400_000).toISOString();
    store.saveFinishedCheckin({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      householdId: created.body.household.id,
      memberId: june.id,
      mode: 'live',
      startedAt: at,
      endedAt: at,
      durationMs: 36000,
      mood: i === 5 ? 'uneasy' : 'steady',
      note: i === 5 ? 'Woke a lot.' : null,
      pulse: i === 5 ? 96 : 70,
      pulseConfidence: 70,
      breathing: i === 5 ? 22 : 14,
      breathingConfidence: 60,
      hrvRmssd: null,
      hrvSdnn: null,
      hrvMeanNn: null,
      hrvConfidence: null,
      expressionWords: null,
      validationOkRatio: 0.8,
      pulseValidSeconds: 12,
      breathingValidSeconds: 10,
      hrvValidSeconds: null,
      pulseSamples: 12,
      breathingSamples: 10,
      hrvSamples: null,
      endedReason: 'stop',
      trace: [],
    });
  }

  const story = await agent.get(`/api/people/${june.id}/story`);
  assert.equal(story.status, 200);
  assert.equal(story.body.latest.verdict.status, 'different');
  assert.match(story.body.latest.verdict.explanation, /June/);
  assert.equal(story.body.days.length, 6);

  const summary = await agent.get(`/api/people/${june.id}/summary`);
  assert.equal(summary.status, 200);
  assert.match(summary.body.plainText, /What we observed/);
  assert.match(summary.body.narrative, /not a medical device/i);
  assert.match(summary.body.narrative, /Woke a lot/);

  const missing = await agent.post('/api/checkins').send({ pulse: 200 });
  assert.equal(missing.status, 404);

  const exported = await agent.get('/api/export');
  assert.equal(exported.status, 200);
  assert.equal(exported.body.rules.minValidSeconds, 8);
  assert.equal(exported.body.rules.minDistinctDays, 5);
  assert.equal(exported.body.checkins.length, 6);
  assert.equal(exported.body.checkins[5].pulseValidSeconds, 12);
  assert.equal(JSON.stringify(exported.body).includes('pin_hash'), false);

  const retention = await agent.patch('/api/household').send({ retentionDays: 7 });
  assert.equal(retention.status, 200);
  assert.equal(retention.body.household.retentionDays, 7);

  const withdrawn = await agent.post(`/api/consents/${consent.body.consent.id}/withdraw`);
  assert.equal(withdrawn.status, 200);
  assert.ok(withdrawn.body.consent.withdrawnAt);
  assert.equal(withdrawn.body.consent.consenterName, 'Sam');

  const wiped = await agent.delete('/api/data').send({ confirm: 'delete' });
  assert.equal(wiped.status, 200);
  const after = await agent.get(`/api/people/${june.id}/story`);
  assert.equal(after.body.days.length, 0);

  const still = await agent.get('/api/me');
  assert.equal(still.status, 200);
});

test('sample house seeds and restores, and a real house cannot restore it', async () => {
  resetRates();
  const built = testApp(false);
  seedDemo(built.store);
  const agent = request.agent(built.app);
  const login = await agent.post('/api/session').send({ code: 'maple', pin: '2468' });
  assert.equal(login.status, 200);
  assert.equal(login.body.household.demo, true);

  const me = await agent.get('/api/me');
  const june = me.body.members.find(
    (member: { displayName: string }) => member.displayName === 'June',
  );
  const arthur = me.body.members.find(
    (member: { displayName: string }) => member.displayName === 'Arthur',
  );
  const juneStory = await agent.get(`/api/people/${june.id}/story`);
  const arthurStory = await agent.get(`/api/people/${arthur.id}/story`);
  assert.equal(juneStory.body.latest.verdict.status, 'usual');
  assert.equal(
    juneStory.body.days.some((day: { status: string }) => day.status === 'different'),
    true,
  );
  assert.equal(arthurStory.body.latest.verdict.status, 'learning');

  await agent.delete('/api/data').send({ confirm: 'delete' });
  const empty = await agent.get(`/api/people/${june.id}/story`);
  assert.equal(empty.body.days.length, 0);
  const restored = await agent.post('/api/demo/restore');
  assert.equal(restored.status, 200);
  const back = await agent.get(`/api/people/${june.id}/story`);
  assert.ok(back.body.days.length > 5);

  const real = testApp(false);
  const realAgent = request.agent(real.app);
  await realAgent.post('/api/households').send({
    name: 'Real',
    pin: '9753',
    carerName: 'Sam',
    personName: 'June',
  });
  const denied = await realAgent.post('/api/demo/restore');
  assert.equal(denied.status, 404);
  real.db.close();
  built.db.close();
});
