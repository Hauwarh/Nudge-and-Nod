/**
 * Map a decoded SmartSpectra Metrics payload into the small set of numbers
 * we show and, later, store. Video never enters this module.
 *
 * Field names follow the Node metrics guide (camelCase). Snake_case is
 * accepted too, in case a decoder leaves proto names alone.
 */

export interface Measure {
  value: number;
  confidence: number;
  stable: boolean;
}

export interface HrvMeasure {
  rmssd: number;
  sdnn: number | null;
  meanNn: number | null;
  confidence: number;
  stable: boolean;
}

export interface FaceGlance {
  words: string;
  confidence: number;
}

export interface SignalSnapshot {
  pulse: Measure | null;
  breathing: Measure | null;
  hrv: HrvMeasure | null;
  expression: FaceGlance | null;
  talking: boolean | null;
  /** Latest arterial-pressure waveform sample. Shape only — not blood pressure. */
  pulseTrace: number | null;
  breathTrace: number | null;
  /** Latest sample that met the library's steady-confidence mark. */
  kept: {
    pulse: Measure | null;
    breathing: Measure | null;
    hrv: HrvMeasure | null;
    expression: FaceGlance | null;
  };
}

export const PULSE_SHOW_MIN = 0;
export const PULSE_KEEP_MIN = 40;
export const BREATHING_KEEP_MIN = 45;
export const HRV_KEEP_MIN = 50;

const EXPRESSION_WORDS: Record<string, string> = {
  '1': 'a tense brow',
  ANGRY: 'a tense brow',
  '2': 'a tight look',
  CONTEMPT: 'a tight look',
  '3': 'a wince',
  DISGUST: 'a wince',
  '4': 'a startled look',
  FEAR: 'a startled look',
  '5': 'a smile',
  HAPPY: 'a smile',
  '6': 'a quiet face',
  NEUTRAL: 'a quiet face',
  '7': 'a heavy look',
  SAD: 'a heavy look',
  '8': 'a surprised look',
  SURPRISE: 'a surprised look',
};

export function emptySnapshot(): SignalSnapshot {
  return {
    pulse: null,
    breathing: null,
    hrv: null,
    expression: null,
    talking: null,
    pulseTrace: null,
    breathTrace: null,
    kept: { pulse: null, breathing: null, hrv: null, expression: null },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return null;
  return value as Record<string, unknown>;
}

function field(record: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function list(record: Record<string, unknown> | null, ...keys: string[]): unknown[] {
  const value = field(record, ...keys);
  return Array.isArray(value) ? value : [];
}

function last(items: unknown[]): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return asRecord(items[items.length - 1]);
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function measureFrom(row: Record<string, unknown> | null): Measure | null {
  if (!row) return null;
  const value = num(field(row, 'value'));
  const confidence = num(field(row, 'confidence')) ?? 0;
  if (value === null) return null;
  return { value: Math.round(value * 10) / 10, confidence, stable: bool(field(row, 'stable')) };
}

function keepMeasure(
  current: Measure | null,
  previous: Measure | null,
  minConfidence: number,
): Measure | null {
  if (current && current.confidence >= minConfidence) return current;
  return previous;
}

export function expressionWords(type: unknown): string | null {
  if (typeof type === 'number' && Number.isFinite(type))
    return EXPRESSION_WORDS[String(type)] ?? null;
  if (typeof type === 'string') {
    const key = type.trim().toUpperCase();
    return EXPRESSION_WORDS[key] ?? EXPRESSION_WORDS[type.trim()] ?? null;
  }
  return null;
}

function readExpression(face: Record<string, unknown> | null): FaceGlance | null {
  const row = last(list(face, 'expression'));
  if (!row) return null;
  const scores = list(row, 'scores');
  let bestWords: string | null = null;
  let bestConfidence = -1;
  for (const score of scores) {
    const record = asRecord(score);
    if (!record) continue;
    const words = expressionWords(field(record, 'type'));
    const confidence = num(field(record, 'confidence')) ?? 0;
    if (words && confidence > bestConfidence) {
      bestWords = words;
      bestConfidence = confidence;
    }
  }
  if (!bestWords || bestConfidence < 30) return null;
  return { words: bestWords, confidence: bestConfidence };
}

function readHrv(cardio: Record<string, unknown> | null): HrvMeasure | null {
  const row = last(list(cardio, 'hrv'));
  if (!row) return null;
  const rmssd = num(field(row, 'rmssd'));
  const confidence = num(field(row, 'confidence')) ?? 0;
  if (rmssd === null) return null;
  return {
    rmssd: Math.round(rmssd * 10) / 10,
    sdnn: num(field(row, 'sdnn')),
    meanNn: num(field(row, 'meanNn', 'mean_nn')),
    confidence,
    stable: bool(field(row, 'stable')),
  };
}

function readTalking(face: Record<string, unknown> | null): boolean | null {
  const row = last(list(face, 'talking'));
  if (!row) return null;
  if (!('detected' in row)) return null;
  return bool(row.detected);
}

/**
 * Fold one decoded metrics message into the running snapshot.
 * `decoded` is whatever `@smartspectra/node-sdk/messages` `decodeMetrics` returns.
 */
export function applyMetrics(previous: SignalSnapshot, decoded: unknown): SignalSnapshot {
  const root = asRecord(decoded);
  if (!root) return previous;
  const breathing = asRecord(field(root, 'breathing'));
  const cardio = asRecord(field(root, 'cardio'));
  const face = asRecord(field(root, 'face'));

  const pulse = measureFrom(last(list(cardio, 'pulseRate', 'pulse_rate'))) ?? previous.pulse;
  const breath = measureFrom(last(list(breathing, 'rate'))) ?? previous.breathing;
  const hrv = readHrv(cardio) ?? previous.hrv;
  const expression = readExpression(face) ?? previous.expression;
  const talking = readTalking(face);
  const pulseTrace =
    num(field(last(list(cardio, 'arterialPressureTrace', 'arterial_pressure_trace')), 'value')) ??
    previous.pulseTrace;
  const breathTrace =
    num(field(last(list(breathing, 'upperTrace', 'upper_trace')), 'value')) ?? previous.breathTrace;

  return {
    pulse,
    breathing: breath,
    hrv,
    expression,
    talking: talking === null ? previous.talking : talking,
    pulseTrace,
    breathTrace,
    kept: {
      pulse: keepMeasure(pulse, previous.kept.pulse, PULSE_KEEP_MIN),
      breathing: keepMeasure(breath, previous.kept.breathing, BREATHING_KEEP_MIN),
      hrv: hrv && hrv.confidence >= HRV_KEEP_MIN ? hrv : previous.kept.hrv,
      expression: expression ?? previous.kept.expression,
    },
  };
}

export function publicSignals(
  snapshot: SignalSnapshot,
  validation: { code: number; hint: string },
) {
  return {
    type: 'signals' as const,
    pulse: snapshot.pulse && snapshot.pulse.confidence > PULSE_SHOW_MIN ? snapshot.pulse : null,
    breathing:
      snapshot.breathing && snapshot.breathing.confidence > PULSE_SHOW_MIN
        ? snapshot.breathing
        : null,
    hrv: snapshot.hrv && snapshot.hrv.confidence > PULSE_SHOW_MIN ? snapshot.hrv : null,
    expression: snapshot.expression,
    talking: snapshot.talking === true,
    pulseTrace: snapshot.pulseTrace,
    breathTrace: snapshot.breathTrace,
    validation,
  };
}
