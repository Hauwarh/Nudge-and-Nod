/**
 * Compare one check-in with that person's own recent check-ins.
 *
 * The band is a Tukey fence (1.5 × IQR beyond the middle half) with a floor
 * so a run of identical days is not hypersensitive. It describes spread in
 * this household's record. It is not a medical threshold and it is not a
 * statement about health.
 */

export type CheckinMode = 'live' | 'demo';

export interface Observation {
  id: string;
  at: string;
  mode: CheckinMode;
  pulse: number | null;
  pulseConfidence: number | null;
  /** Seconds in which pulse confidence met the steady mark. Null means unknown, and unknown does not count. */
  pulseValidSeconds: number | null;
  breathing: number | null;
  breathingConfidence: number | null;
  breathingValidSeconds: number | null;
}

export type SignalState = 'inside' | 'outside' | 'learning' | 'missing' | 'unread' | 'short';

export interface Band {
  n: number;
  q1: number;
  median: number;
  q3: number;
  low: number;
  high: number;
}

export type VerdictStatus = 'usual' | 'different' | 'learning' | 'quiet' | 'sample';

export interface Verdict {
  status: VerdictStatus;
  headline: string;
  explanation: string;
  pulse: SignalState;
  breathing: SignalState;
  pulseBand: Band | null;
  breathingBand: Band | null;
  pulseValue: number | null;
  breathingValue: number | null;
}

export interface Assessed {
  observation: Observation;
  verdict: Verdict;
}

/**
 * Minimum earlier days, each with its own qualifying reading, before we
 * compare. Several check-ins on the same date count as one day.
 */
export const MIN_HISTORY = 5;
/** Steady seconds required inside one check-in before that signal can be compared. */
export const MIN_VALID_SECONDS = 8;
/** How many earlier check-ins the band is drawn from. */
export const HISTORY_WINDOW = 14;

/**
 * SDK docs: pulse `stable` corresponds to confidence >= 40 (±3 bpm operating
 * point). Breathing `stable` corresponds to confidence >= 45 (±1 breath/min).
 * We use those same figures as "steady enough to keep in the record we
 * compare", and we say so in the explanation. They are the library's own
 * quality flags, not a clinical cutoff.
 */
export const PULSE_STEADY = 40;
export const BREATHING_STEADY = 45;

/** Pulse method range published by Presage. Outside it, we do not compare. */
export const PULSE_READ_MIN = 40;
export const PULSE_READ_MAX = 110;
export const BREATHING_READ_MIN = 5;
export const BREATHING_READ_MAX = 40;

/**
 * When the middle half barely moves, still allow this much of a step before
 * calling a day different. Part of the method, not a healthy-range claim.
 */
export const PULSE_FLOOR_STEP = 6;
export const BREATHING_FLOOR_STEP = 2;

/** The rules a reader can check. Kept next to the code that applies them. */
export const COMPARISON_RULES = {
  pulseConfidenceMin: PULSE_STEADY,
  breathingConfidenceMin: BREATHING_STEADY,
  hrvConfidenceMin: 50,
  minValidSeconds: MIN_VALID_SECONDS,
  minDistinctDays: MIN_HISTORY,
  historyWindowDays: HISTORY_WINDOW,
  pulseFloorStepBpm: PULSE_FLOOR_STEP,
  breathingFloorStep: BREATHING_FLOOR_STEP,
  pulseReadable: [PULSE_READ_MIN, PULSE_READ_MAX],
  breathingReadable: [BREATHING_READ_MIN, BREATHING_READ_MAX],
  freshWithinMs: 3000,
  dayKey: 'UTC date of the stored timestamp (YYYY-MM-DD)',
  notUsedForUsual: ['HRV', 'expressions', 'talking', 'arterial pressure shape'],
} as const;

export function quantile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) throw new Error('quantile of empty');
  const only = sortedAsc[0];
  if (sortedAsc.length === 1) return only ?? 0;
  const position = (sortedAsc.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lo = sortedAsc[lower];
  const hi = sortedAsc[upper];
  if (lo === undefined || hi === undefined) throw new Error('quantile index');
  if (lower === upper) return lo;
  const weight = position - lower;
  return lo * (1 - weight) + hi * weight;
}

export function bandFor(values: readonly number[], floorStep: number): Band {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const spread = Math.max((q3 - q1) * 1.5, floorStep);
  return {
    n: sorted.length,
    q1,
    median,
    q3,
    low: q1 - spread,
    high: q3 + spread,
  };
}

function whole(n: number): string {
  return String(Math.round(n));
}

type Usable =
  { kind: 'value'; value: number } | { kind: 'unread' } | { kind: 'short'; value: number } | null;

function dayKey(at: string): string {
  return at.slice(0, 10);
}

function qualify(
  mode: CheckinMode,
  value: number | null,
  confidence: number | null,
  validSeconds: number | null,
  steady: number,
  min: number,
  max: number,
): Usable {
  if (mode !== 'live' || value === null) return null;
  if (confidence !== null && confidence < steady) return null;
  if (value < min || value > max) return { kind: 'unread' };
  if (validSeconds === null || validSeconds < MIN_VALID_SECONDS) return { kind: 'short', value };
  return { kind: 'value', value };
}

function usablePulse(observation: Observation): Usable {
  return qualify(
    observation.mode,
    observation.pulse,
    observation.pulseConfidence,
    observation.pulseValidSeconds,
    PULSE_STEADY,
    PULSE_READ_MIN,
    PULSE_READ_MAX,
  );
}

function usableBreathing(observation: Observation): Usable {
  return qualify(
    observation.mode,
    observation.breathing,
    observation.breathingConfidence,
    observation.breathingValidSeconds,
    BREATHING_STEADY,
    BREATHING_READ_MIN,
    BREATHING_READ_MAX,
  );
}

/** Latest qualifying reading on each UTC date, then the most recent window. */
function priorValues(prior: Observation[], pick: (observation: Observation) => Usable): number[] {
  const byDay = new Map<string, number>();
  for (const row of prior) {
    const usable = pick(row);
    if (usable?.kind === 'value') byDay.set(dayKey(row.at), usable.value);
  }
  const days = [...byDay.keys()].sort();
  return days.slice(-HISTORY_WINDOW).map((day) => byDay.get(day) ?? 0);
}

interface SignalVerdict {
  state: SignalState;
  band: Band | null;
  value: number | null;
}

function judgeSignal(current: Usable, history: number[], floorStep: number): SignalVerdict {
  if (current?.kind === 'unread') {
    return { state: 'unread', band: null, value: null };
  }
  if (current?.kind === 'short') {
    return { state: 'short', band: null, value: current.value };
  }
  if (!current) return { state: 'missing', band: null, value: null };
  if (history.length < MIN_HISTORY) {
    return { state: 'learning', band: null, value: current.value };
  }
  const band = bandFor(history, floorStep);
  const state: SignalState =
    current.value >= band.low && current.value <= band.high ? 'inside' : 'outside';
  return { state, band, value: current.value };
}

function headline(status: VerdictStatus): string {
  switch (status) {
    case 'usual':
      return 'Looks like a usual day';
    case 'different':
      return 'Different from their usual days';
    case 'learning':
      return 'Still learning their usual';
    case 'quiet':
      return 'No steady stretch this time';
    case 'sample':
      return 'Sample check-in';
  }
}

function rangePhrase(band: Band, unit: string): string {
  return `about ${whole(band.q1)} to ${whole(band.q3)} ${unit} (the middle half of those days). We only call it different outside ${whole(band.low)} to ${whole(band.high)}`;
}

function explain(
  name: string,
  pulse: SignalVerdict,
  breathing: SignalVerdict,
  status: VerdictStatus,
): string {
  if (status === 'sample') {
    return 'This sitting used sample signals. It is not part of the record we compare.';
  }
  if (status === 'quiet') {
    const unread =
      pulse.state === 'unread' || breathing.state === 'unread'
        ? ' A number fell outside the range this camera method can read (pulse 40–110, breathing 5–40), so it was left out.'
        : '';
    const short =
      pulse.state === 'short' || breathing.state === 'short'
        ? ` A number showed up, but not for ${MIN_VALID_SECONDS} separate steady seconds, so it stays out of the comparison.`
        : '';
    return `${name}'s check-in did not leave a long enough steady pulse or breathing stretch to compare.${unread}${short}`;
  }

  const bits: string[] = [];
  if (pulse.state === 'inside' && pulse.band && pulse.value !== null) {
    bits.push(
      `Pulse was ${whole(pulse.value)}, inside ${name}'s recent check-ins: ${rangePhrase(pulse.band, 'beats per minute')}.`,
    );
  } else if (pulse.state === 'outside' && pulse.band && pulse.value !== null) {
    bits.push(
      `Pulse was ${whole(pulse.value)}, outside the spread of ${name}'s recent check-ins: ${rangePhrase(pulse.band, 'beats per minute')}.`,
    );
  } else if (pulse.state === 'learning' && pulse.value !== null) {
    bits.push(
      `Pulse was ${whole(pulse.value)}. There are not yet ${MIN_HISTORY} earlier days with a steady pulse, so this number is only written down.`,
    );
  } else if (pulse.state === 'short' && pulse.value !== null) {
    bits.push(
      `Pulse was ${whole(pulse.value)}, but it was not steady for ${MIN_VALID_SECONDS} seconds, so it is left out of the band.`,
    );
  } else if (pulse.state === 'unread') {
    bits.push(
      'The pulse number was outside 40–110, which is the range this camera method reads, so it was not compared.',
    );
  }

  if (breathing.state === 'inside' && breathing.band && breathing.value !== null) {
    bits.push(
      `Breathing was ${whole(breathing.value)}, inside ${name}'s recent check-ins: ${rangePhrase(breathing.band, 'breaths per minute')}.`,
    );
  } else if (breathing.state === 'outside' && breathing.band && breathing.value !== null) {
    bits.push(
      `Breathing was ${whole(breathing.value)}, outside the spread of ${name}'s recent check-ins: ${rangePhrase(breathing.band, 'breaths per minute')}.`,
    );
  } else if (breathing.state === 'learning' && breathing.value !== null) {
    bits.push(
      `Breathing was ${whole(breathing.value)}. There are not yet ${MIN_HISTORY} earlier days with steady breathing, so this number is only written down.`,
    );
  } else if (breathing.state === 'short' && breathing.value !== null) {
    bits.push(
      `Breathing was ${whole(breathing.value)}, but it was not steady for ${MIN_VALID_SECONDS} seconds, so it is left out of the band.`,
    );
  } else if (breathing.state === 'unread') {
    bits.push(
      'The breathing number was outside 5–40, which is the range this camera method reads, so it was not compared.',
    );
  }

  if (status === 'learning') {
    bits.push(
      `We wait for ${MIN_HISTORY} earlier days, each with at least ${MIN_VALID_SECONDS} steady seconds, before saying whether a day looks usual for ${name}.`,
    );
  }
  if (status === 'different') {
    bits.push(
      'Different only means this check-in does not sit with their own recent days. It is not a diagnosis, and it is not a wellbeing score.',
    );
  }
  if (status === 'usual') {
    bits.push('Usual here means "like their own recent check-ins", not "healthy" or "fine".');
  }
  return bits.join(' ');
}

export function verdictFor(current: Observation, prior: Observation[], name: string): Verdict {
  if (current.mode !== 'live') {
    return {
      status: 'sample',
      headline: headline('sample'),
      explanation: explain(name, emptySignal(), emptySignal(), 'sample'),
      pulse: 'missing',
      breathing: 'missing',
      pulseBand: null,
      breathingBand: null,
      pulseValue: current.pulse,
      breathingValue: current.breathing,
    };
  }

  const pulse = judgeSignal(
    usablePulse(current),
    priorValues(prior, usablePulse),
    PULSE_FLOOR_STEP,
  );
  const breathing = judgeSignal(
    usableBreathing(current),
    priorValues(prior, usableBreathing),
    BREATHING_FLOOR_STEP,
  );

  let status: VerdictStatus;
  const states = [pulse.state, breathing.state];
  if (states.includes('outside')) status = 'different';
  else if (states.includes('inside')) status = 'usual';
  else if (states.includes('learning')) status = 'learning';
  else status = 'quiet';

  const partial =
    status === 'usual' && (pulse.state === 'learning' || breathing.state === 'learning');
  return {
    status,
    headline: partial ? 'Looks like a usual day so far' : headline(status),
    explanation: explain(name, pulse, breathing, status),
    pulse: pulse.state,
    breathing: breathing.state,
    pulseBand: pulse.band,
    breathingBand: breathing.band,
    pulseValue: pulse.value,
    breathingValue: breathing.value,
  };
}

function emptySignal(): SignalVerdict {
  return { state: 'missing', band: null, value: null };
}

export function assessAll(observations: readonly Observation[], name: string): Assessed[] {
  const sorted = [...observations].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
  return sorted.map((observation, index) => ({
    observation,
    verdict: verdictFor(observation, sorted.slice(0, index), name),
  }));
}
