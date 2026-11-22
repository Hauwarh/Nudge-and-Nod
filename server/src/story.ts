import {
  assessAll,
  type Assessed,
  type Band,
  type Observation,
  type Verdict,
  type VerdictStatus,
} from './baseline.js';
import { MOOD_LABEL, NOT_A_MEDICAL_DEVICE, type Mood } from './copy.js';

export interface StoredCheckin {
  id: string;
  at: string;
  endedAt: string | null;
  mode: 'live' | 'demo';
  mood: Mood | null;
  note: string | null;
  pulse: number | null;
  pulseConfidence: number | null;
  breathing: number | null;
  breathingConfidence: number | null;
  hrvRmssd: number | null;
  hrvSdnn: number | null;
  hrvMeanNn: number | null;
  hrvConfidence: number | null;
  expressionWords: string | null;
  durationMs: number | null;
  pulseValidSeconds: number | null;
  breathingValidSeconds: number | null;
  hrvValidSeconds: number | null;
  pulseSamples: number | null;
  breathingSamples: number | null;
  hrvSamples: number | null;
  endedReason: string | null;
}

export interface StoryDay {
  id: string;
  at: string;
  mode: 'live' | 'demo';
  mood: Mood | null;
  moodLabel: string | null;
  note: string | null;
  pulse: number | null;
  breathing: number | null;
  hrvRmssd: number | null;
  hrvSdnn: number | null;
  hrvMeanNn: number | null;
  hrvConfidence: number | null;
  expressionWords: string | null;
  durationMs: number | null;
  pulseValidSeconds: number | null;
  breathingValidSeconds: number | null;
  hrvValidSeconds: number | null;
  pulseSamples: number | null;
  breathingSamples: number | null;
  hrvSamples: number | null;
  endedReason: string | null;
  status: VerdictStatus;
  pulseState: Verdict['pulse'];
  breathingState: Verdict['breathing'];
}

export interface StoryModel {
  name: string;
  latest: {
    at: string;
    verdict: Verdict;
  } | null;
  days: StoryDay[];
  disclaimer: string;
}

export interface SummaryModel {
  householdName: string;
  memberName: string;
  from: string | null;
  to: string | null;
  shown: number;
  total: number;
  narrative: string;
  plainText: string;
  days: StoryDay[];
  disclaimer: string;
  generatedAt: string;
}

function toObservation(row: StoredCheckin): Observation {
  return {
    id: row.id,
    at: row.at,
    mode: row.mode,
    pulse: row.pulse,
    pulseConfidence: row.pulseConfidence,
    pulseValidSeconds: row.pulseValidSeconds,
    breathing: row.breathing,
    breathingConfidence: row.breathingConfidence,
    breathingValidSeconds: row.breathingValidSeconds,
  };
}

function toDay(row: StoredCheckin, verdict: Verdict): StoryDay {
  return {
    id: row.id,
    at: row.at,
    mode: row.mode,
    mood: row.mood,
    moodLabel: row.mood ? MOOD_LABEL[row.mood] : null,
    note: row.note,
    pulse: row.pulse,
    breathing: row.breathing,
    hrvRmssd: hrvShown(row),
    hrvSdnn: row.hrvConfidence !== null && row.hrvConfidence >= 50 ? row.hrvSdnn : null,
    hrvMeanNn: row.hrvConfidence !== null && row.hrvConfidence >= 50 ? row.hrvMeanNn : null,
    hrvConfidence: row.hrvConfidence,
    expressionWords: row.expressionWords,
    durationMs: row.durationMs,
    pulseValidSeconds: row.pulseValidSeconds,
    breathingValidSeconds: row.breathingValidSeconds,
    hrvValidSeconds: row.hrvValidSeconds,
    pulseSamples: row.pulseSamples,
    breathingSamples: row.breathingSamples,
    hrvSamples: row.hrvSamples,
    endedReason: row.endedReason,
    status: verdict.status,
    pulseState: verdict.pulse,
    breathingState: verdict.breathing,
  };
}

function hrvShown(row: StoredCheckin): number | null {
  if (row.hrvRmssd === null) return null;
  if (row.hrvConfidence === null) return row.hrvRmssd;
  return row.hrvConfidence >= 50 ? row.hrvRmssd : null;
}

export function buildStory(name: string, rows: readonly StoredCheckin[]): StoryModel {
  const assessed = assessAll(rows.map(toObservation), name);
  const byId = new Map<string, Assessed>(assessed.map((item) => [item.observation.id, item]));
  const ordered = [...rows].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const days = ordered.map((row) => {
    const found = byId.get(row.id);
    return toDay(row, found?.verdict ?? quietFallback());
  });
  const latestRow = bestSittingOfLatestDay(ordered, byId);
  const latestAssessed = latestRow ? byId.get(latestRow.id) : undefined;
  return {
    name,
    latest:
      latestRow && latestAssessed ? { at: latestRow.at, verdict: latestAssessed.verdict } : null,
    days,
    disclaimer: NOT_A_MEDICAL_DEVICE,
  };
}

function sittingRank(status: VerdictStatus): number {
  if (status === 'usual' || status === 'different') return 3;
  if (status === 'learning') return 2;
  return 1;
}

/** If a later empty sit shares the latest date, keep the stronger sitting of that day. */
function bestSittingOfLatestDay(
  ordered: StoredCheckin[],
  byId: Map<string, Assessed>,
): StoredCheckin | undefined {
  const last = ordered[ordered.length - 1];
  if (!last) return undefined;
  const day = last.at.slice(0, 10);
  const sameDay = ordered.filter((row) => row.at.slice(0, 10) === day);
  let best = sameDay[0] ?? last;
  let bestScore = -1;
  for (const row of sameDay) {
    const verdict = byId.get(row.id)?.verdict;
    const seconds = (row.pulseValidSeconds ?? 0) + (row.breathingValidSeconds ?? 0);
    const score = sittingRank(verdict?.status ?? 'quiet') * 1000 + seconds;
    if (score >= bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

export function shouldKeepCheckin(input: {
  pulseValidSeconds: number | null;
  breathingValidSeconds: number | null;
  mood: string | null;
  note: string | null;
}): boolean {
  if ((input.pulseValidSeconds ?? 0) > 0 || (input.breathingValidSeconds ?? 0) > 0) return true;
  if (input.mood || input.note) return true;
  return false;
}

function friendlyDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function quietFallback(): Verdict {
  return {
    status: 'quiet',
    headline: 'No steady stretch this time',
    explanation: '',
    pulse: 'missing',
    breathing: 'missing',
    pulseBand: null,
    breathingBand: null,
    pulseValue: null,
    breathingValue: null,
  };
}

function countMoods(days: StoryDay[]): string {
  const counts = new Map<string, number>();
  for (const day of days) {
    if (!day.moodLabel) continue;
    counts.set(day.moodLabel, (counts.get(day.moodLabel) ?? 0) + 1);
  }
  if (counts.size === 0)
    return `${days.length === 1 ? 'There is' : 'There are'} no tapped pictures in this window.`;
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => `${label} ${count}`);
  return `Pictures tapped: ${parts.join(', ')}.`;
}

function bandSentence(label: string, band: Band | null, unit: string): string | null {
  if (!band) return null;
  return `${label} over the check-ins behind the latest one mostly sat between ${Math.round(band.q1)} and ${Math.round(band.q3)} ${unit}.`;
}

export function buildSummary(input: {
  householdName: string;
  memberName: string;
  rows: readonly StoredCheckin[];
  limit?: number;
  now?: Date;
}): SummaryModel {
  const limit = input.limit ?? 14;
  const story = buildStory(input.memberName, input.rows);
  const total = story.days.length;
  const days = story.days.slice(-limit);
  const from = days[0]?.at ?? null;
  const to = days[days.length - 1]?.at ?? null;
  const latest = story.latest;
  const paragraphs: string[] = [];
  if (!latest) {
    paragraphs.push(`${input.memberName} has no check-ins in the kept record.`);
  } else {
    paragraphs.push(latest.verdict.explanation);
    const pulseBand = bandSentence('Pulse', latest.verdict.pulseBand, 'beats per minute');
    const breathBand = bandSentence(
      'Breathing',
      latest.verdict.breathingBand,
      'breaths per minute',
    );
    if (pulseBand) paragraphs.push(pulseBand);
    if (breathBand) paragraphs.push(breathBand);
  }
  paragraphs.push(countMoods(days));
  const notes = days.filter((day) => day.note);
  if (notes.length === 0) {
    paragraphs.push('No typed notes in this window.');
  } else {
    paragraphs.push(
      notes
        .map((day) => {
          const when = friendlyDay(day.at);
          return `${when}: ${day.note}`;
        })
        .join('\n'),
    );
  }
  if (total > days.length) {
    paragraphs.push(`Showing the latest ${days.length} of ${total} kept check-ins.`);
  }
  paragraphs.push(
    'The camera ran only during check-ins someone started, with the person there. Video frames were not saved. This page keeps derived numbers, the picture they tapped, and notes they typed.',
  );
  paragraphs.push(NOT_A_MEDICAL_DEVICE);

  const narrative = paragraphs.join('\n\n');
  const generatedAt = (input.now ?? new Date()).toISOString();
  const plainText = [
    `What we observed — ${input.memberName}`,
    input.householdName,
    from && to ? `${from.slice(0, 10)} to ${to.slice(0, 10)}` : 'No check-ins yet',
    '',
    narrative,
  ].join('\n');

  return {
    householdName: input.householdName,
    memberName: input.memberName,
    from,
    to,
    shown: days.length,
    total,
    narrative,
    plainText,
    days,
    disclaimer: NOT_A_MEDICAL_DEVICE,
    generatedAt,
  };
}
