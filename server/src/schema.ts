export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: '001_init',
    sql: `
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('person', 'carer')),
  created_at TEXT NOT NULL
);

CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  agreed_as TEXT NOT NULL CHECK (agreed_as IN ('self', 'with_them')),
  text_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'demo')),
  mood TEXT,
  note TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  pulse_bpm REAL,
  pulse_confidence REAL,
  breathing_rpm REAL,
  breathing_confidence REAL,
  hrv_rmssd REAL,
  hrv_sdnn REAL,
  hrv_mean_nn REAL,
  hrv_confidence REAL,
  expression_words TEXT,
  validation_ok_ratio REAL,
  trace_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_checkins_member_time ON checkins (member_id, started_at);
CREATE INDEX idx_sessions_household ON sessions (household_id);
CREATE INDEX idx_members_household ON members (household_id);
`,
  },
  {
    id: '002_coverage_consent',
    sql: `
ALTER TABLE checkins ADD COLUMN pulse_valid_seconds INTEGER;
ALTER TABLE checkins ADD COLUMN breathing_valid_seconds INTEGER;
ALTER TABLE checkins ADD COLUMN hrv_valid_seconds INTEGER;
ALTER TABLE checkins ADD COLUMN pulse_samples INTEGER;
ALTER TABLE checkins ADD COLUMN breathing_samples INTEGER;
ALTER TABLE checkins ADD COLUMN hrv_samples INTEGER;
ALTER TABLE checkins ADD COLUMN ended_reason TEXT;
ALTER TABLE consents ADD COLUMN consenter_name TEXT;
ALTER TABLE consents ADD COLUMN withdrawn_at TEXT;
`,
  },
];
