import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAll, bandFor, quantile, type Observation, verdictFor } from '../src/baseline.js';

function obs(partial: Partial<Observation> & Pick<Observation, 'id' | 'at'>): Observation {
  return {
    mode: 'live',
    pulse: null,
    pulseConfidence: 70,
    pulseValidSeconds: 12,
    breathing: null,
    breathingConfidence: 60,
    breathingValidSeconds: 10,
    ...partial,
  };
}

test('quantile interpolates between ranks', () => {
  const sorted = [1, 2, 3, 4];
  assert.equal(quantile(sorted, 0), 1);
  assert.equal(quantile(sorted, 1), 4);
  assert.equal(quantile(sorted, 0.5), 2.5);
  assert.ok(Math.abs(quantile(sorted, 0.25) - 1.75) < 1e-9);
  assert.ok(Math.abs(quantile(sorted, 0.75) - 3.25) < 1e-9);
});

test('a flat record uses the floor step, not a hair trigger', () => {
  const priors = [1, 2, 3, 4, 5].map((n) =>
    obs({ id: `p${n}`, at: `2026-01-0${n}T09:00:00.000Z`, pulse: 70, breathing: 14 }),
  );
  const close = obs({ id: 'today', at: '2026-01-06T09:00:00.000Z', pulse: 72, breathing: 15 });
  const usual = verdictFor(close, priors, 'June');
  assert.equal(usual.status, 'usual');
  assert.equal(usual.pulse, 'inside');
  assert.match(usual.explanation, /June/);
  assert.match(usual.explanation, /not "healthy"/);

  const far = obs({ id: 'today', at: '2026-01-06T09:00:00.000Z', pulse: 90, breathing: 14 });
  const different = verdictFor(far, priors, 'June');
  assert.equal(different.status, 'different');
  assert.equal(different.pulse, 'outside');
  assert.equal(different.breathing, 'inside');
  assert.match(different.explanation, /not a diagnosis/);
});

test('fewer than five earlier steady check-ins is still learning', () => {
  const priors = [1, 2, 3].map((n) =>
    obs({ id: `p${n}`, at: `2026-02-0${n}T09:00:00.000Z`, pulse: 64 + n, breathing: 15 }),
  );
  const today = obs({ id: 't', at: '2026-02-04T09:00:00.000Z', pulse: 80, breathing: 15 });
  const verdict = verdictFor(today, priors, 'Arthur');
  assert.equal(verdict.status, 'learning');
  assert.equal(verdict.pulse, 'learning');
  assert.match(verdict.explanation, /Arthur/);
});

test('low confidence, demo rows, and unread ranges are left out of the band', () => {
  const priors = [
    obs({ id: 'a', at: '2026-03-01T09:00:00.000Z', pulse: 70, breathing: 14 }),
    obs({
      id: 'b',
      at: '2026-03-02T09:00:00.000Z',
      pulse: 120,
      pulseConfidence: 90,
      breathing: 14,
    }),
    obs({ id: 'c', at: '2026-03-03T09:00:00.000Z', pulse: 40, pulseConfidence: 10, breathing: 14 }),
    obs({
      id: 'd',
      at: '2026-03-04T09:00:00.000Z',
      mode: 'demo',
      pulse: 140,
      breathing: 30,
    }),
  ];
  const today = obs({ id: 'e', at: '2026-03-05T09:00:00.000Z', pulse: 71, breathing: 14 });
  const verdict = verdictFor(today, priors, 'June');
  assert.equal(verdict.status, 'learning');
  assert.equal(verdict.pulseBand, null);
});

test('a short sit with no steady number stays quiet', () => {
  const priors = [1, 2, 3, 4, 5].map((n) =>
    obs({ id: `p${n}`, at: `2026-04-0${n}T09:00:00.000Z`, pulse: 70, breathing: 14 }),
  );
  const today = obs({
    id: 't',
    at: '2026-04-06T09:00:00.000Z',
    pulse: 70,
    pulseConfidence: 10,
    breathing: null,
    breathingConfidence: null,
  });
  const verdict = verdictFor(today, priors, 'June');
  assert.equal(verdict.status, 'quiet');
});

test('the made-up June series marks one day different and the latest usual', () => {
  const series = [
    [70, 14],
    [68, 15],
    [72, 13],
    [71, 14],
    [69, 16],
    [73, 14],
    [70, 15],
    [74, 13],
    [96, 22],
    [73, 15],
    [71, 14],
  ];
  const rows = series.map(([pulse, breathing], index) =>
    obs({
      id: `d${index}`,
      at: `2026-05-${String(index + 1).padStart(2, '0')}T09:30:00.000Z`,
      pulse,
      breathing,
    }),
  );
  const assessed = assessAll(rows, 'June');
  const odd = assessed[8];
  const latest = assessed[10];
  assert.ok(odd);
  assert.ok(latest);
  assert.equal(odd.verdict.status, 'different');
  assert.equal(odd.verdict.pulse, 'outside');
  assert.equal(odd.verdict.breathing, 'outside');
  assert.equal(latest.verdict.status, 'usual');
  assert.equal(latest.verdict.pulse, 'inside');
  assert.equal(latest.verdict.breathing, 'inside');
});

test('several sittings on one date are still one day', () => {
  const priors = [1, 2, 3, 4, 5].map((n) =>
    obs({
      id: `s${n}`,
      at: `2026-07-01T0${n}:00:00.000Z`,
      pulse: 70,
      breathing: 14,
    }),
  );
  const today = obs({ id: 't', at: '2026-07-02T09:00:00.000Z', pulse: 90, breathing: 14 });
  const verdict = verdictFor(today, priors, 'June');
  assert.equal(verdict.status, 'learning');
  assert.equal(verdict.pulse, 'learning');
});

test('a short steady stretch is written down and not compared', () => {
  const priors = [1, 2, 3, 4, 5].map((n) =>
    obs({
      id: `p${n}`,
      at: `2026-08-0${n}T09:00:00.000Z`,
      pulse: 70,
      breathing: 14,
    }),
  );
  const today = obs({
    id: 't',
    at: '2026-08-06T09:00:00.000Z',
    pulse: 96,
    pulseValidSeconds: 3,
    breathing: 22,
    breathingValidSeconds: 2,
  });
  const verdict = verdictFor(today, priors, 'June');
  assert.equal(verdict.status, 'quiet');
  assert.equal(verdict.pulse, 'short');
  assert.match(verdict.explanation, /8 separate steady seconds/);
});

test('band floor widens a zero IQR', () => {
  const band = bandFor([70, 70, 70, 70, 70], 6);
  assert.equal(band.low, 64);
  assert.equal(band.high, 76);
  assert.equal(band.n, 5);
});
