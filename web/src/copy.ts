/** Keep this paragraph in step with server/src/copy.ts. */
export const NOT_A_MEDICAL_DEVICE =
  'Nudge & Nod is not a medical device. It does not diagnose, recommend treatment, or turn a sitting into a wellbeing score. “Usual” and “different” only compare a person with their own recent check-ins. If you are worried, contact a doctor or a person you trust.';

export const WHAT_THIS_IS_NOT = [
  'Not a medical device.',
  'No diagnosis, and no advice about treatment or care.',
  'No wellbeing score, stress score, or ready-or-not number.',
  '“Usual” means “like their own recent check-ins here”. It does not mean healthy.',
].join(' ');

/** Shown on every screen. The full paragraph lives on Welcome, Settings and the summary. */
export const SHORT_DISCLAIMER =
  'Not a medical device. If you are worried about someone, contact a doctor or a person you trust.';

export const MOODS = [
  { id: 'sunny', label: 'Good', hint: 'A bright day' },
  { id: 'steady', label: 'Okay', hint: 'Steady enough' },
  { id: 'tired', label: 'Tired', hint: 'Low on energy' },
  { id: 'uneasy', label: 'Unsettled', hint: 'Not quite right' },
  { id: 'company', label: 'Stay close', hint: 'Someone near, please' },
] as const;

export const MOOD_BY_LABEL: Record<string, (typeof MOODS)[number]['id']> = {
  Good: 'sunny',
  Okay: 'steady',
  Tired: 'tired',
  Unsettled: 'uneasy',
  'Stay close': 'company',
};

export type MoodId = (typeof MOODS)[number]['id'];

export const TELEMETRY_NOTE = [
  'Picture frames travel from the phone to this household’s Nudge & Nod server during a check-in, over an encrypted connection. They are held in memory only long enough to be read. They are not written to disk, not written to the log, and not shared onward as video.',
  'The measurement library is SmartSpectra, from Presage, and it runs on that server. A live check-in does contact Presage. That required traffic authenticates our API key and lets the library set itself up. We do not claim the app is offline, and we have not audited every byte of the proprietary library.',
  'Optional telemetry is a separate switch. We set enableTelemetry to false. If it were on, Presage would also receive session summaries (SDK version, operating system, input kind, frame-rate statistics, counts of validation warnings, a coarse error code, a timestamp) and, for a device check, a fuller report that can include free text such as file paths. Those reports ride an authenticated request, so they can be tied to the API key’s account. They do not include video or the vital signs themselves. Presage says the reports do not currently expire on their own. Turning telemetry off does not turn off the authentication and setup traffic.',
  'We do not send anything to an AI service. We never call SmartSpectra’s LLM Insights feature. Speech is not turned into text. A note is only what someone types.',
].join('\n\n');
