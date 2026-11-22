/** Keep this paragraph in step with web/src/copy.ts. */
export const NOT_A_MEDICAL_DEVICE =
  'Nudge & Nod is not a medical device. It does not diagnose, recommend treatment, or turn a sitting into a wellbeing score. “Usual” and “different” only compare a person with their own recent check-ins. If you are worried, contact a doctor or a person you trust.';

export const CONSENT_VERSION = '2026-11-21.2';

export const MOODS = ['sunny', 'steady', 'tired', 'uneasy', 'company'] as const;
export type Mood = (typeof MOODS)[number];

export const MOOD_LABEL: Record<Mood, string> = {
  sunny: 'Good',
  steady: 'Okay',
  tired: 'Tired',
  uneasy: 'Unsettled',
  company: 'Stay close',
};
