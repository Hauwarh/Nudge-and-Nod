import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMetrics, emptySnapshot, expressionWords, publicSignals } from '../src/metrics.js';

test('expression words stay descriptive, not diagnostic', () => {
  assert.equal(expressionWords(5), 'a smile');
  assert.equal(expressionWords('HAPPY'), 'a smile');
  assert.equal(expressionWords('neutral'), 'a quiet face');
  assert.equal(expressionWords(0), null);
});

test('applyMetrics keeps a steady pulse and ignores a later unsteady one', () => {
  let snapshot = emptySnapshot();
  snapshot = applyMetrics(snapshot, {
    cardio: { pulseRate: [{ value: 72.4, confidence: 61, stable: true }] },
    breathing: { rate: [{ value: 8, confidence: 0, stable: false }] },
  });
  assert.equal(snapshot.pulse?.value, 72.4);
  assert.equal(snapshot.kept.pulse?.value, 72.4);
  assert.equal(snapshot.kept.breathing, null);

  snapshot = applyMetrics(snapshot, {
    cardio: { pulse_rate: [{ value: 110, confidence: 12, stable: false }] },
    face: {
      expression: [{ scores: [{ type: 'NEUTRAL', confidence: 70 }] }],
      talking: [{ detected: true }],
    },
  });
  assert.equal(snapshot.pulse?.value, 110);
  assert.equal(snapshot.kept.pulse?.value, 72.4);
  assert.equal(snapshot.expression?.words, 'a quiet face');
  assert.equal(snapshot.talking, true);
});

test('snake_case traces and HRV confidence gate are read', () => {
  const snapshot = applyMetrics(emptySnapshot(), {
    cardio: {
      arterial_pressure_trace: [{ value: 0.25, confidence: 50, stable: true }],
      hrv: [{ rmssd: 33.2, sdnn: 40, mean_nn: 800, confidence: 55, stable: true }],
    },
    breathing: { upper_trace: [{ value: -0.4, stable: true }] },
  });
  assert.equal(snapshot.pulseTrace, 0.25);
  assert.equal(snapshot.breathTrace, -0.4);
  assert.equal(snapshot.kept.hrv?.rmssd, 33.2);
  assert.equal(snapshot.kept.hrv?.meanNn, 800);
});

test('publicSignals shows breathing at confidence 0 while kept stays empty', () => {
  const snapshot = applyMetrics(emptySnapshot(), {
    breathing: { rate: [{ value: 24.2, confidence: 0, stable: false }] },
  });
  assert.equal(snapshot.kept.breathing, null);
  const shown = publicSignals(snapshot, { code: 0, hint: '' });
  assert.equal(shown.breathing?.value, 24.2);
  assert.equal(shown.breathing?.confidence, 0);
});

test('a raw buffer is ignored', () => {
  const snapshot = applyMetrics(emptySnapshot(), Buffer.from('nope'));
  assert.equal(snapshot.pulse, null);
});
