import { randomUUID } from 'node:crypto';
import type { Mood } from './copy.js';
import type { Store } from './store.js';

interface DaySeed {
  ago: number;
  pulse: number;
  breathing: number;
  mood: Mood;
  note: string | null;
}

const JUNE_DAYS: DaySeed[] = [
  { ago: 11, pulse: 70, breathing: 14, mood: 'sunny', note: 'Slept through.' },
  { ago: 10, pulse: 68, breathing: 15, mood: 'steady', note: null },
  { ago: 9, pulse: 72, breathing: 13, mood: 'sunny', note: 'Sat in the garden.' },
  { ago: 8, pulse: 71, breathing: 14, mood: 'tired', note: "Didn't feel like talking." },
  { ago: 7, pulse: 69, breathing: 16, mood: 'steady', note: null },
  { ago: 6, pulse: 73, breathing: 14, mood: 'sunny', note: 'Soup for lunch.' },
  { ago: 5, pulse: 70, breathing: 15, mood: 'steady', note: 'The neighbour called.' },
  { ago: 4, pulse: 74, breathing: 13, mood: 'sunny', note: null },
  { ago: 3, pulse: 96, breathing: 22, mood: 'uneasy', note: 'Woke a lot in the night.' },
  { ago: 2, pulse: 73, breathing: 15, mood: 'tired', note: 'Better today.' },
  { ago: 1, pulse: 71, breathing: 14, mood: 'steady', note: null },
];

const ARTHUR_DAYS: DaySeed[] = [
  { ago: 6, pulse: 64, breathing: 16, mood: 'steady', note: 'Quiet morning.' },
  { ago: 4, pulse: 66, breathing: 15, mood: 'sunny', note: null },
  { ago: 2, pulse: 65, breathing: 16, mood: 'tired', note: 'Long nap.' },
];

/**
 * Made-up days for the sample house. Judges can look around without a camera
 * or an API key. The rows use mode "live" so the comparison has a record to
 * read; the household code "maple" is what marks the house as a sample.
 */
export function seedDemo(store: Store): void {
  if (store.householdByCode('maple')) return;
  const house = store.createHouseholdWithCode({
    name: 'The Maple house',
    code: 'maple',
    pin: '2468',
    members: [
      { displayName: 'Sam', role: 'carer' },
      { displayName: 'June', role: 'person' },
      { displayName: 'Arthur', role: 'person' },
    ],
  });
  writeSampleDays(store, house.id);
}

/**
 * Put the made-up days back after a delete. Replaces check-ins in the Maple
 * house only. A real house is left alone.
 */
export function restoreDemoDays(store: Store): boolean {
  const house = store.householdByCode('maple');
  if (!house) return false;
  store.deleteHouseholdData(house.id);
  writeSampleDays(store, house.id);
  return true;
}

function writeSampleDays(store: Store, householdId: string): void {
  const members = store.members(householdId);
  const june = members.find((member) => member.displayName === 'June');
  const arthur = members.find((member) => member.displayName === 'Arthur');
  if (!june || !arthur) return;
  for (const day of JUNE_DAYS) writeDay(store, householdId, june.id, day);
  for (const day of ARTHUR_DAYS) writeDay(store, householdId, arthur.id, day);
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(9, 30, 0, 0);
  return date.toISOString();
}

function writeDay(store: Store, householdId: string, memberId: string, day: DaySeed): void {
  const startedAt = daysAgoIso(day.ago);
  const ended = new Date(Date.parse(startedAt) + 36_000);
  store.saveFinishedCheckin({
    id: randomUUID(),
    householdId,
    memberId,
    mode: 'live',
    startedAt,
    endedAt: ended.toISOString(),
    durationMs: 36_000,
    mood: day.mood,
    note: day.note,
    pulse: day.pulse,
    pulseConfidence: 72,
    breathing: day.breathing,
    breathingConfidence: 60,
    hrvRmssd: null,
    hrvSdnn: null,
    hrvMeanNn: null,
    hrvConfidence: null,
    expressionWords: day.mood === 'sunny' ? 'a smile' : 'a quiet face',
    validationOkRatio: 0.9,
    pulseValidSeconds: 15,
    breathingValidSeconds: 10,
    hrvValidSeconds: null,
    pulseSamples: 15,
    breathingSamples: 10,
    hrvSamples: null,
    endedReason: 'stop',
    trace: [],
  });
}
