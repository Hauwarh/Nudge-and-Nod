import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyCoverage, freshSeen, phaseOf, recordSample } from '../src/coverage.js';

test('a second is counted once, and a low-confidence sample is not a valid second', () => {
  const coverage = emptyCoverage();
  const seen = freshSeen();
  recordSample(coverage, seen, 'pulse', 1000, 1, 70, 40);
  recordSample(coverage, seen, 'pulse', 1400, 1, 72, 40);
  recordSample(coverage, seen, 'pulse', 2000, 2, 20, 40);
  assert.equal(coverage.pulse.validSeconds, 1);
  assert.equal(coverage.pulse.samples, 3);
  assert.equal(phaseOf(coverage.pulse, 2500, 20), 'live');
  assert.equal(phaseOf(coverage.pulse, 2000 + 3001, 20), 'stale');
  assert.equal(phaseOf(emptyCoverage().pulse, 1000, null), 'warming');
});
