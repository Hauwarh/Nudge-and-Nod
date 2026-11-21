/**
 * Per-signal bookkeeping for one sitting.
 * A valid second is a clock second in which at least one sample met the
 * library's steady-confidence mark. Seconds are not filled in when a sample
 * is missing, and a gap does not invent a value.
 */

export const FRESH_MS = 3_000;
export const MIN_VALID_SECONDS = 8;

export type SignalPhase = 'warming' | 'live' | 'stale';

export interface SignalCoverage {
  samples: number;
  validSeconds: number;
  /** Wall time of the last sample with confidence above zero. */
  lastAtMs: number | null;
}

export interface SittingCoverage {
  pulse: SignalCoverage;
  breathing: SignalCoverage;
  hrv: SignalCoverage;
}

export function emptyCoverage(): SittingCoverage {
  return {
    pulse: { samples: 0, validSeconds: 0, lastAtMs: null },
    breathing: { samples: 0, validSeconds: 0, lastAtMs: null },
    hrv: { samples: 0, validSeconds: 0, lastAtMs: null },
  };
}

/**
 * `secondIndex` is the sitting's clock second (0, 1, 2…). Calling this twice
 * in the same second does not add a second valid second.
 * `seenSeconds` is the set of second indexes already counted for this signal.
 */
export function recordSample(
  coverage: SittingCoverage,
  seenSeconds: Record<'pulse' | 'breathing' | 'hrv', Set<number>>,
  signal: 'pulse' | 'breathing' | 'hrv',
  atMs: number,
  secondIndex: number,
  confidence: number,
  keepMin: number,
): void {
  const current = coverage[signal];
  if (!(confidence > 0)) return;
  coverage[signal] = {
    samples: current.samples + 1,
    validSeconds:
      current.validSeconds +
      (confidence >= keepMin && !seenSeconds[signal].has(secondIndex) ? 1 : 0),
    lastAtMs: atMs,
  };
  if (confidence >= keepMin) seenSeconds[signal].add(secondIndex);
}

export function phaseOf(
  signal: SignalCoverage,
  nowMs: number,
  confidence: number | null,
): SignalPhase {
  if (signal.lastAtMs === null || confidence === null || !(confidence > 0)) return 'warming';
  if (nowMs - signal.lastAtMs > FRESH_MS) return 'stale';
  return 'live';
}

export function freshSeen(): Record<'pulse' | 'breathing' | 'hrv', Set<number>> {
  return { pulse: new Set(), breathing: new Set(), hrv: new Set() };
}
