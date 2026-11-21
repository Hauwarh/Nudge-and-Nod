export interface Member {
  id: string;
  householdId: string;
  displayName: string;
  role: 'person' | 'carer';
  createdAt: string;
}

export interface Household {
  id: string;
  name: string;
  code: string;
  retentionDays: number;
  createdAt: string;
  demo: boolean;
}

export interface LiveStatus {
  keyConfigured: boolean;
  sdkPresent: boolean;
  busy: boolean;
  telemetry: boolean;
}

export interface Me {
  household: Household;
  members: Member[];
  live: LiveStatus;
  disclaimer: string;
  consentVersion: string;
}

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
  pulse: string;
  breathing: string;
  pulseBand: Band | null;
  breathingBand: Band | null;
  pulseValue: number | null;
  breathingValue: number | null;
}

export interface StoryDay {
  id: string;
  at: string;
  mode: 'live' | 'demo';
  mood: string | null;
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
  pulseState: string;
  breathingState: string;
}

export interface Story {
  member: Member;
  name: string;
  latest: { at: string; verdict: Verdict } | null;
  days: StoryDay[];
  disclaimer: string;
}

export interface Summary {
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
