import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStory,
  shouldKeepCheckin,
  verdictForCheckin,
  type StoredCheckin,
} from '../src/story.js';

function row(partial: Partial<StoredCheckin> & Pick<StoredCheckin, 'id' | 'at'>): StoredCheckin {
  return {
    endedAt: partial.at,
    mode: 'live',
    mood: null,
    note: null,
    pulse: 70,
    pulseConfidence: 70,
    breathing: 14,
    breathingConfidence: 60,
    hrvRmssd: null,
    hrvSdnn: null,
    hrvMeanNn: null,
    hrvConfidence: null,
    expressionWords: null,
    durationMs: 36_000,
    pulseValidSeconds: 12,
    breathingValidSeconds: 10,
    hrvValidSeconds: null,
    pulseSamples: 12,
    breathingSamples: 10,
    hrvSamples: null,
    endedReason: 'stop',
    ...partial,
  };
}

test('a later empty sit does not replace a valid sitting from the same day', () => {
  const story = buildStory('June', [
    row({ id: 'good', at: '2026-11-21T09:00:00.000Z', pulse: 71, breathing: 14 }),
    row({
      id: 'short',
      at: '2026-11-21T09:10:00.000Z',
      pulse: null,
      pulseConfidence: null,
      breathing: null,
      breathingConfidence: null,
      pulseValidSeconds: 0,
      breathingValidSeconds: 0,
    }),
  ]);
  assert.equal(story.latest?.verdict.status, 'learning');
  assert.equal(story.latest?.at, '2026-11-21T09:00:00.000Z');
  assert.notEqual(story.latest?.verdict.headline, 'No steady stretch this time');
});

test('a thin sit with a picture keeps its own quiet verdict, not an earlier usual day', () => {
  const history = [11, 12, 13, 14, 15].map((day) =>
    row({
      id: `day-${day}`,
      at: `2026-11-${day}T09:00:00.000Z`,
      pulse: 70,
      breathing: 14,
    }),
  );
  const morning = row({
    id: 'morning',
    at: '2026-11-21T09:00:00.000Z',
    pulse: 70,
    breathing: 14,
  });
  const thin = row({
    id: 'thin',
    at: '2026-11-21T18:00:00.000Z',
    mood: 'tired',
    note: 'Sat for a moment',
    pulse: null,
    pulseConfidence: null,
    breathing: null,
    breathingConfidence: null,
    pulseValidSeconds: 0,
    breathingValidSeconds: 0,
  });
  const rows = [...history, morning, thin];
  const own = verdictForCheckin('June', rows, 'thin');
  assert.equal(own?.status, 'quiet');
  assert.equal(own?.pulseValue, null);
  assert.equal(own?.breathingValue, null);
  assert.match(own?.explanation ?? '', /not leave a long enough steady/i);
  const story = buildStory('June', rows);
  assert.equal(story.latest?.verdict.pulseValue, 70);
  assert.notEqual(story.latest?.verdict.status, own?.status);
});

test('an empty stopped sit is not worth keeping', () => {
  assert.equal(
    shouldKeepCheckin({ pulseValidSeconds: 0, breathingValidSeconds: 0, mood: null, note: null }),
    false,
  );
  assert.equal(
    shouldKeepCheckin({
      pulseValidSeconds: 0,
      breathingValidSeconds: 0,
      mood: 'tired',
      note: null,
    }),
    true,
  );
  assert.equal(
    shouldKeepCheckin({ pulseValidSeconds: 8, breathingValidSeconds: 0, mood: null, note: null }),
    true,
  );
});
