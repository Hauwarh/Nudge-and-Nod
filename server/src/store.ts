import { randomInt, randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import { HttpError } from './errors.js';
import { hashPin, hashToken, newToken, verifyPin } from './pins.js';
import type { Mood } from './copy.js';
import type { StoredCheckin } from './story.js';

const WORDS = [
  'alder',
  'birch',
  'cedar',
  'clover',
  'fern',
  'hazel',
  'heather',
  'holly',
  'ivy',
  'linden',
  'meadow',
  'moss',
  'olive',
  'pebble',
  'pine',
  'quince',
  'reed',
  'rowan',
  'sage',
  'thistle',
  'willow',
  'wren',
  'brook',
  'daisy',
  'yarrow',
] as const;

const SESSION_DAYS = 30;

export interface Household {
  id: string;
  name: string;
  code: string;
  retentionDays: number;
  createdAt: string;
  demo: boolean;
}

export interface Member {
  id: string;
  householdId: string;
  displayName: string;
  role: 'person' | 'carer';
  createdAt: string;
}

export interface Session {
  id: string;
  householdId: string;
  expiresAt: string;
}

export interface Consent {
  id: string;
  householdId: string;
  memberId: string;
  agreedAs: 'self' | 'with_them';
  consenterName: string | null;
  textVersion: string;
  createdAt: string;
  withdrawnAt: string | null;
}

export interface NewCheckin {
  id: string;
  householdId: string;
  memberId: string;
  mode: 'live' | 'demo';
  startedAt: string;
}

export interface FinishedCheckin {
  endedAt: string;
  durationMs: number;
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
  validationOkRatio: number | null;
  pulseValidSeconds: number | null;
  breathingValidSeconds: number | null;
  hrvValidSeconds: number | null;
  pulseSamples: number | null;
  breathingSamples: number | null;
  hrvSamples: number | null;
  endedReason: string | null;
  trace: { t: number; pulse: number | null; breath: number | null }[];
}

interface HouseholdRow {
  id: string;
  name: string;
  code: string;
  pin_hash: string;
  pin_salt: string;
  retention_days: number;
  created_at: string;
}

interface MemberRow {
  id: string;
  household_id: string;
  display_name: string;
  role: 'person' | 'carer';
  created_at: string;
}

interface CheckinRow {
  id: string;
  household_id: string;
  member_id: string;
  mode: 'live' | 'demo';
  mood: string | null;
  note: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  pulse_bpm: number | null;
  pulse_confidence: number | null;
  breathing_rpm: number | null;
  breathing_confidence: number | null;
  hrv_rmssd: number | null;
  hrv_sdnn: number | null;
  hrv_mean_nn: number | null;
  hrv_confidence: number | null;
  expression_words: string | null;
  pulse_valid_seconds: number | null;
  breathing_valid_seconds: number | null;
  hrv_valid_seconds: number | null;
  pulse_samples: number | null;
  breathing_samples: number | null;
  hrv_samples: number | null;
  ended_reason: string | null;
}

function houseFrom(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    retentionDays: row.retention_days,
    createdAt: row.created_at,
    demo: row.code === 'maple',
  };
}

function memberFrom(row: MemberRow): Member {
  return {
    id: row.id,
    householdId: row.household_id,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };
}

function isMood(value: string | null): value is Mood {
  return (
    value === 'sunny' ||
    value === 'steady' ||
    value === 'tired' ||
    value === 'uneasy' ||
    value === 'company'
  );
}

export class Store {
  constructor(private readonly db: DB) {}

  createHousehold(input: { name: string; pin: string; carerName: string; personName: string }): {
    household: Household;
    carer: Member;
    person: Member;
    token: string;
  } {
    const code = this.freshCode();
    const id = randomUUID();
    const now = new Date().toISOString();
    const pin = hashPin(input.pin);
    const carer: Member = {
      id: randomUUID(),
      householdId: id,
      displayName: input.carerName,
      role: 'carer',
      createdAt: now,
    };
    const person: Member = {
      id: randomUUID(),
      householdId: id,
      displayName: input.personName,
      role: 'person',
      createdAt: now,
    };
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO households (id, name, code, pin_hash, pin_salt, retention_days, created_at)
           VALUES (?, ?, ?, ?, ?, 30, ?)`,
        )
        .run(id, input.name, code, pin.hash, pin.salt, now);
      const memberStmt = this.db.prepare(
        `INSERT INTO members (id, household_id, display_name, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      memberStmt.run(carer.id, id, carer.displayName, carer.role, now);
      memberStmt.run(person.id, id, person.displayName, person.role, now);
    });
    insert();
    const household = this.mustHouse(id);
    const token = this.openSession(id);
    return { household, carer, person, token };
  }

  /** Used by the sample-house seed. `code` must be unique. */
  createHouseholdWithCode(input: {
    name: string;
    code: string;
    pin: string;
    members: { displayName: string; role: 'person' | 'carer' }[];
  }): Household {
    const existing = this.householdByCode(input.code);
    if (existing) return existing;
    const id = randomUUID();
    const now = new Date().toISOString();
    const pin = hashPin(input.pin);
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO households (id, name, code, pin_hash, pin_salt, retention_days, created_at)
           VALUES (?, ?, ?, ?, ?, 30, ?)`,
        )
        .run(id, input.name, input.code, pin.hash, pin.salt, now);
      const memberStmt = this.db.prepare(
        `INSERT INTO members (id, household_id, display_name, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      input.members.forEach((member, index) => {
        const at = new Date(Date.parse(now) + index * 1000).toISOString();
        memberStmt.run(randomUUID(), id, member.displayName, member.role, at);
      });
    });
    insert();
    return this.mustHouse(id);
  }

  login(code: string, pin: string): { household: Household; token: string } | null {
    const row = this.db
      .prepare('SELECT * FROM households WHERE code = ?')
      .get(code.trim().toLowerCase()) as HouseholdRow | undefined;
    if (!row) return null;
    if (!verifyPin(pin, row.pin_hash, row.pin_salt)) return null;
    return { household: houseFrom(row), token: this.openSession(row.id) };
  }

  sessionFromToken(token: string): Session | null {
    const tokenHash = hashToken(token);
    const row = this.db
      .prepare('SELECT id, household_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as { id: string; household_id: string; expires_at: string } | undefined;
    if (!row) return null;
    if (row.expires_at < new Date().toISOString()) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
      return null;
    }
    return { id: row.id, householdId: row.household_id, expiresAt: row.expires_at };
  }

  endSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  householdById(id: string): Household | null {
    const row = this.db.prepare('SELECT * FROM households WHERE id = ?').get(id) as
      HouseholdRow | undefined;
    return row ? houseFrom(row) : null;
  }

  householdByCode(code: string): Household | null {
    const row = this.db.prepare('SELECT * FROM households WHERE code = ?').get(code) as
      HouseholdRow | undefined;
    return row ? houseFrom(row) : null;
  }

  members(householdId: string): Member[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM members WHERE household_id = ? ORDER BY created_at ASC, display_name ASC',
      )
      .all(householdId) as MemberRow[];
    return rows.map(memberFrom);
  }

  member(householdId: string, memberId: string): Member | null {
    const row = this.db
      .prepare('SELECT * FROM members WHERE id = ? AND household_id = ?')
      .get(memberId, householdId) as MemberRow | undefined;
    return row ? memberFrom(row) : null;
  }

  addPerson(householdId: string, displayName: string): Member {
    const member: Member = {
      id: randomUUID(),
      householdId,
      displayName,
      role: 'person',
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO members (id, household_id, display_name, role, created_at)
         VALUES (?, ?, ?, 'person', ?)`,
      )
      .run(member.id, householdId, displayName, member.createdAt);
    return member;
  }

  setRetention(householdId: string, days: number): Household {
    this.db.prepare('UPDATE households SET retention_days = ? WHERE id = ?').run(days, householdId);
    return this.mustHouse(householdId);
  }

  addConsent(input: {
    householdId: string;
    memberId: string;
    agreedAs: 'self' | 'with_them';
    consenterName: string;
    textVersion: string;
  }): Consent {
    const member = this.member(input.householdId, input.memberId);
    if (!member || member.role !== 'person') {
      throw new HttpError(404, 'We could not find that person in this house.', 'not_found');
    }
    const consent: Consent = {
      id: randomUUID(),
      householdId: input.householdId,
      memberId: input.memberId,
      agreedAs: input.agreedAs,
      consenterName: input.consenterName,
      textVersion: input.textVersion,
      createdAt: new Date().toISOString(),
      withdrawnAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO consents (
           id, household_id, member_id, agreed_as, consenter_name, text_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        consent.id,
        consent.householdId,
        consent.memberId,
        consent.agreedAs,
        consent.consenterName,
        consent.textVersion,
        consent.createdAt,
      );
    return consent;
  }

  withdrawConsent(householdId: string, consentId: string): Consent | null {
    const existing = this.consentById(householdId, consentId);
    if (!existing) return null;
    if (!existing.withdrawnAt) {
      const withdrawnAt = new Date().toISOString();
      this.db
        .prepare('UPDATE consents SET withdrawn_at = ? WHERE id = ? AND household_id = ?')
        .run(withdrawnAt, consentId, householdId);
      existing.withdrawnAt = withdrawnAt;
    }
    return existing;
  }

  consentById(householdId: string, consentId: string): Consent | null {
    const row = this.db
      .prepare(
        `SELECT id, household_id, member_id, agreed_as, consenter_name, text_version, created_at, withdrawn_at
         FROM consents WHERE id = ? AND household_id = ?`,
      )
      .get(consentId, householdId) as
      | {
          id: string;
          household_id: string;
          member_id: string;
          agreed_as: 'self' | 'with_them';
          consenter_name: string | null;
          text_version: string;
          created_at: string;
          withdrawn_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      householdId: row.household_id,
      memberId: row.member_id,
      agreedAs: row.agreed_as,
      consenterName: row.consenter_name,
      textVersion: row.text_version,
      createdAt: row.created_at,
      withdrawnAt: row.withdrawn_at,
    };
  }

  freshConsent(
    householdId: string,
    memberId: string,
    consentId: string,
    maxAgeMs: number,
  ): Consent | null {
    const row = this.db
      .prepare(
        `SELECT id, household_id, member_id, agreed_as, consenter_name, text_version, created_at, withdrawn_at
         FROM consents WHERE id = ? AND household_id = ? AND member_id = ?`,
      )
      .get(consentId, householdId, memberId) as
      | {
          id: string;
          household_id: string;
          member_id: string;
          agreed_as: 'self' | 'with_them';
          consenter_name: string | null;
          text_version: string;
          created_at: string;
          withdrawn_at: string | null;
        }
      | undefined;
    if (!row || row.withdrawn_at) return null;
    const age = Date.now() - Date.parse(row.created_at);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
    return {
      id: row.id,
      householdId: row.household_id,
      memberId: row.member_id,
      agreedAs: row.agreed_as,
      consenterName: row.consenter_name,
      textVersion: row.text_version,
      createdAt: row.created_at,
      withdrawnAt: null,
    };
  }

  beginCheckin(input: NewCheckin): void {
    this.db
      .prepare(
        `INSERT INTO checkins (
           id, household_id, member_id, mode, started_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.householdId,
        input.memberId,
        input.mode,
        input.startedAt,
        input.startedAt,
      );
  }

  /** Insert a finished check-in. Tests and the sample seed use this. */
  saveFinishedCheckin(input: NewCheckin & FinishedCheckin): void {
    this.db
      .prepare(
        `INSERT INTO checkins (
           id, household_id, member_id, mode, mood, note, started_at, ended_at, duration_ms,
           pulse_bpm, pulse_confidence, breathing_rpm, breathing_confidence,
           hrv_rmssd, hrv_sdnn, hrv_mean_nn, hrv_confidence, expression_words,
           validation_ok_ratio, pulse_valid_seconds, breathing_valid_seconds, hrv_valid_seconds,
           pulse_samples, breathing_samples, hrv_samples, ended_reason, trace_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.householdId,
        input.memberId,
        input.mode,
        input.mood,
        input.note,
        input.startedAt,
        input.endedAt,
        input.durationMs,
        input.pulse,
        input.pulseConfidence,
        input.breathing,
        input.breathingConfidence,
        input.hrvRmssd,
        input.hrvSdnn,
        input.hrvMeanNn,
        input.hrvConfidence,
        input.expressionWords,
        input.validationOkRatio,
        input.pulseValidSeconds,
        input.breathingValidSeconds,
        input.hrvValidSeconds,
        input.pulseSamples,
        input.breathingSamples,
        input.hrvSamples,
        input.endedReason,
        JSON.stringify(input.trace),
        input.startedAt,
      );
  }

  touchCheckin(
    id: string,
    householdId: string,
    patch: { mood?: Mood | null; note?: string | null },
  ): void {
    if (patch.mood !== undefined) {
      this.db
        .prepare('UPDATE checkins SET mood = ? WHERE id = ? AND household_id = ?')
        .run(patch.mood, id, householdId);
    }
    if (patch.note !== undefined) {
      this.db
        .prepare('UPDATE checkins SET note = ? WHERE id = ? AND household_id = ?')
        .run(patch.note, id, householdId);
    }
  }

  finishCheckin(id: string, householdId: string, finished: FinishedCheckin): void {
    this.db
      .prepare(
        `UPDATE checkins SET
           mood = COALESCE(?, mood),
           note = COALESCE(?, note),
           ended_at = ?,
           duration_ms = ?,
           pulse_bpm = ?,
           pulse_confidence = ?,
           breathing_rpm = ?,
           breathing_confidence = ?,
           hrv_rmssd = ?,
           hrv_sdnn = ?,
           hrv_mean_nn = ?,
           hrv_confidence = ?,
           expression_words = ?,
           validation_ok_ratio = ?,
           pulse_valid_seconds = ?,
           breathing_valid_seconds = ?,
           hrv_valid_seconds = ?,
           pulse_samples = ?,
           breathing_samples = ?,
           hrv_samples = ?,
           ended_reason = ?,
           trace_json = ?
         WHERE id = ? AND household_id = ?`,
      )
      .run(
        finished.mood,
        finished.note,
        finished.endedAt,
        finished.durationMs,
        finished.pulse,
        finished.pulseConfidence,
        finished.breathing,
        finished.breathingConfidence,
        finished.hrvRmssd,
        finished.hrvSdnn,
        finished.hrvMeanNn,
        finished.hrvConfidence,
        finished.expressionWords,
        finished.validationOkRatio,
        finished.pulseValidSeconds,
        finished.breathingValidSeconds,
        finished.hrvValidSeconds,
        finished.pulseSamples,
        finished.breathingSamples,
        finished.hrvSamples,
        finished.endedReason,
        JSON.stringify(finished.trace),
        id,
        householdId,
      );
  }

  checkinsFor(householdId: string, memberId: string): StoredCheckin[] {
    const rows = this.db
      .prepare(
        `SELECT id, household_id, member_id, mode, mood, note, started_at, ended_at, duration_ms,
                pulse_bpm, pulse_confidence, breathing_rpm, breathing_confidence,
                hrv_rmssd, hrv_sdnn, hrv_mean_nn, hrv_confidence, expression_words,
                pulse_valid_seconds, breathing_valid_seconds, hrv_valid_seconds,
                pulse_samples, breathing_samples, hrv_samples, ended_reason
         FROM checkins
         WHERE household_id = ? AND member_id = ?
         ORDER BY started_at ASC`,
      )
      .all(householdId, memberId) as CheckinRow[];
    return rows.map((row) => ({
      id: row.id,
      at: row.started_at,
      endedAt: row.ended_at,
      mode: row.mode,
      mood: isMood(row.mood) ? row.mood : null,
      note: row.note,
      pulse: row.pulse_bpm,
      pulseConfidence: row.pulse_confidence,
      breathing: row.breathing_rpm,
      breathingConfidence: row.breathing_confidence,
      hrvRmssd: row.hrv_rmssd,
      hrvSdnn: row.hrv_sdnn,
      hrvMeanNn: row.hrv_mean_nn,
      hrvConfidence: row.hrv_confidence,
      expressionWords: row.expression_words,
      durationMs: row.duration_ms,
      pulseValidSeconds: row.pulse_valid_seconds,
      breathingValidSeconds: row.breathing_valid_seconds,
      hrvValidSeconds: row.hrv_valid_seconds,
      pulseSamples: row.pulse_samples,
      breathingSamples: row.breathing_samples,
      hrvSamples: row.hrv_samples,
      endedReason: row.ended_reason,
    }));
  }

  deleteHouseholdData(householdId: string): { checkins: number; consents: number } {
    const checkins = this.db
      .prepare('DELETE FROM checkins WHERE household_id = ?')
      .run(householdId);
    const consents = this.db
      .prepare('DELETE FROM consents WHERE household_id = ?')
      .run(householdId);
    return { checkins: checkins.changes, consents: consents.changes };
  }

  purgeExpired(now = new Date()): number {
    const houses = this.db.prepare('SELECT id, retention_days FROM households').all() as {
      id: string;
      retention_days: number;
    }[];
    let removed = 0;
    const stmt = this.db.prepare('DELETE FROM checkins WHERE household_id = ? AND started_at < ?');
    for (const house of houses) {
      const cutoff = new Date(now.getTime() - house.retention_days * 24 * 60 * 60 * 1000);
      removed += stmt.run(house.id, cutoff.toISOString()).changes;
    }
    return removed;
  }

  private openSession(householdId: string): string {
    const token = newToken();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    this.db
      .prepare(
        `INSERT INTO sessions (id, household_id, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), householdId, hashToken(token), now.toISOString(), expires.toISOString());
    return token;
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const word = WORDS[randomInt(WORDS.length)] ?? 'willow';
      const code = attempt < 20 ? word : `${word}${randomInt(10)}`;
      const taken = this.db.prepare('SELECT 1 FROM households WHERE code = ?').get(code);
      if (!taken) return code;
    }
    return `house${randomInt(1000)}`;
  }

  private mustHouse(id: string): Household {
    const house = this.householdById(id);
    if (!house) throw new HttpError(500, 'The house went missing mid-save.', 'server');
    return house;
  }
}
