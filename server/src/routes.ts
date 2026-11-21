import { Router } from 'express';
import { z } from 'zod';
import type { Config } from './config.js';
import { clearedCookie, sessionCookie, tokenFromRequest } from './cookies.js';
import { COMPARISON_RULES } from './baseline.js';
import { CONSENT_VERSION, NOT_A_MEDICAL_DEVICE } from './copy.js';
import { HttpError } from './errors.js';
import { clearRate, hit, tooMany } from './rate-limit.js';
import { restoreDemoDays } from './seed.js';
import { sdkBusy, sdkPackagePresent } from './sdk.js';
import { buildStory, buildSummary } from './story.js';
import type { Store } from './store.js';

const Name = z
  .string()
  .trim()
  .min(1, 'A name is needed.')
  .max(40, 'That name is a bit long.')
  .refine((value) => !hasControlChar(value), 'That name has a character we cannot keep.');

const Pin = z.string().regex(/^\d{4,6}$/, 'The PIN should be 4 to 6 digits.');

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 31) return true;
  }
  return false;
}

const CreateBody = z.object({
  name: z.string().trim().min(2, 'Give the house a name.').max(48),
  pin: Pin,
  carerName: Name,
  personName: Name,
});

const LoginBody = z.object({
  code: z.string().trim().min(2).max(24),
  pin: Pin,
});

const MemberBody = z.object({ displayName: Name });

const RetentionBody = z.object({
  retentionDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});

const ConsentBody = z.object({
  memberId: z.string().uuid(),
  agreedAs: z.enum(['self', 'with_them']),
  consenterName: Name,
});

const DeleteBody = z.object({
  confirm: z.literal('delete'),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'Some of that did not look right.';
    throw new HttpError(400, message, 'invalid');
  }
  return result.data;
}

export function apiRouter(store: Store, config: Config): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'nudge-and-nod',
      keyConfigured: Boolean(config.apiKey),
      sdkPresent: sdkPackagePresent(),
      busy: sdkBusy(),
      telemetry: config.telemetry,
    });
  });

  router.post('/households', (req, res) => {
    const ip = req.ip || 'local';
    if (tooMany(`create:${ip}`, 5, 60 * 60 * 1000)) {
      throw new HttpError(429, 'Too many new houses from here. Wait a while.', 'rate');
    }
    const body = parse(CreateBody, req.body);
    hit(`create:${ip}`, 60 * 60 * 1000);
    const created = store.createHousehold(body);
    res.setHeader('Set-Cookie', sessionCookie(created.token, req.secure));
    res.status(201).json({
      household: created.household,
      members: [created.carer, created.person],
    });
  });

  router.post('/session', (req, res) => {
    const body = parse(LoginBody, req.body);
    const code = body.code.trim().toLowerCase();
    const key = `login:${req.ip || 'local'}:${code}`;
    if (tooMany(key, 8, 15 * 60 * 1000)) {
      throw new HttpError(429, 'Too many tries. Wait a few minutes.', 'rate');
    }
    const session = store.login(code, body.pin);
    if (!session) {
      hit(key, 15 * 60 * 1000);
      throw new HttpError(401, 'That house word and PIN do not match.', 'auth');
    }
    clearRate(key);
    res.setHeader('Set-Cookie', sessionCookie(session.token, req.secure));
    res.json({ household: session.household });
  });

  router.delete('/session', (req, res) => {
    const token = tokenFromRequest(req);
    if (token) store.endSession(token);
    res.setHeader('Set-Cookie', clearedCookie(req.secure));
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const household = householdFrom(req);
    res.json({
      household,
      members: store.members(household.id),
      live: liveStatus(config),
      disclaimer: NOT_A_MEDICAL_DEVICE,
      consentVersion: CONSENT_VERSION,
    });
  });

  router.patch('/household', (req, res) => {
    const household = householdFrom(req);
    const body = parse(RetentionBody, req.body);
    const updated = store.setRetention(household.id, body.retentionDays);
    store.purgeExpired();
    res.json({ household: updated });
  });

  router.post('/members', (req, res) => {
    const household = householdFrom(req);
    const body = parse(MemberBody, req.body);
    const member = store.addPerson(household.id, body.displayName);
    res.status(201).json({ member });
  });

  router.post('/consents', (req, res) => {
    const household = householdFrom(req);
    const body = parse(ConsentBody, req.body);
    const consent = store.addConsent({
      householdId: household.id,
      memberId: body.memberId,
      agreedAs: body.agreedAs,
      consenterName: body.consenterName,
      textVersion: CONSENT_VERSION,
    });
    res.status(201).json({ consent });
  });

  router.get('/people/:id/story', (req, res) => {
    const household = householdFrom(req);
    const member = personOr404(store, household.id, req.params.id);
    const rows = store.checkinsFor(household.id, member.id);
    res.json({
      member,
      ...buildStory(member.displayName, rows),
    });
  });

  router.get('/people/:id/summary', (req, res) => {
    const household = householdFrom(req);
    const member = personOr404(store, household.id, req.params.id);
    const rows = store.checkinsFor(household.id, member.id);
    res.json(
      buildSummary({
        householdName: household.name,
        memberName: member.displayName,
        rows,
      }),
    );
  });

  router.post('/consents/:id/withdraw', (req, res) => {
    const household = householdFrom(req);
    if (!z.string().uuid().safeParse(req.params.id).success) {
      throw new HttpError(404, 'That agreement is not in this house.', 'not_found');
    }
    const consent = store.withdrawConsent(household.id, req.params.id);
    if (!consent) throw new HttpError(404, 'That agreement is not in this house.', 'not_found');
    res.json({
      consent,
      message:
        'Agreement withdrawn. The camera should already be off. Saved days stay until you delete them.',
    });
  });

  router.get('/export', (req, res) => {
    const household = householdFrom(req);
    const members = store.members(household.id);
    const checkins = members.flatMap((member) =>
      store.checkinsFor(household.id, member.id).map((row) => ({
        ...row,
        memberName: member.displayName,
      })),
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="nudge-and-nod-history.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      disclaimer: NOT_A_MEDICAL_DEVICE,
      rules: COMPARISON_RULES,
      household: {
        name: household.name,
        code: household.code,
        retentionDays: household.retentionDays,
      },
      members: members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        role: member.role,
      })),
      checkins,
      note: 'Video frames are not in this file. They are not stored.',
    });
  });

  router.delete('/data', (req, res) => {
    const household = householdFrom(req);
    parse(DeleteBody, req.body);
    const removed = store.deleteHouseholdData(household.id);
    res.json({ ok: true, ...removed });
  });

  router.post('/demo/restore', (req, res) => {
    const household = householdFrom(req);
    if (!household.demo) {
      throw new HttpError(404, 'Sample days belong to the Maple house only.', 'not_found');
    }
    const ip = req.ip || 'local';
    if (tooMany(`restore:${ip}`, 6, 60 * 60 * 1000)) {
      throw new HttpError(429, 'Too many restores. Wait a while.', 'rate');
    }
    hit(`restore:${ip}`, 60 * 60 * 1000);
    const ok = restoreDemoDays(store);
    if (!ok) throw new HttpError(404, 'The sample house is not here.', 'not_found');
    res.json({ ok: true });
  });

  return router;

  function householdFrom(req: Parameters<typeof tokenFromRequest>[0]) {
    const token = tokenFromRequest(req);
    if (!token) throw new HttpError(401, 'Come in with the house word and PIN first.', 'auth');
    const session = store.sessionFromToken(token);
    if (!session) throw new HttpError(401, 'That visit has expired. Come in again.', 'auth');
    const household = store.householdById(session.householdId);
    if (!household) throw new HttpError(401, 'That house is no longer here.', 'auth');
    return household;
  }
}

function personOr404(store: Store, householdId: string, memberId: string | undefined) {
  if (!memberId || !z.string().uuid().safeParse(memberId).success) {
    throw new HttpError(404, 'We could not find that person in this house.', 'not_found');
  }
  const member = store.member(householdId, memberId);
  if (!member || member.role !== 'person') {
    throw new HttpError(404, 'We could not find that person in this house.', 'not_found');
  }
  return member;
}

function liveStatus(config: Config) {
  return {
    keyConfigured: Boolean(config.apiKey),
    sdkPresent: sdkPackagePresent(),
    busy: sdkBusy(),
    telemetry: config.telemetry,
  };
}
