import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { Config } from './config.js';
import { readCookie } from './cookies.js';
import { NOT_A_MEDICAL_DEVICE, type Mood } from './copy.js';
import { parseFrame } from './frames.js';
import { guardedOpen, SdkStartupError, type SdkHost } from './sdk-host.js';
import { logger } from './logger.js';
import { releaseSdk } from './sdk.js';
import { buildStory } from './story.js';
import type { Store } from './store.js';

const CONSENT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const SESSION_CAP_MS = 3 * 60 * 1000;
const FRAME_CAP_PER_SEC = 30;

function isMood(value: unknown): value is Mood {
  return (
    value === 'sunny' ||
    value === 'steady' ||
    value === 'tired' ||
    value === 'uneasy' ||
    value === 'company'
  );
}

function stripControls(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)) continue;
    out += value[i];
  }
  return out;
}

function cleanNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = stripControls(value).trim().slice(0, 280);
  return cleaned.length > 0 ? cleaned : null;
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

/**
 * One browser check-in per socket. Frames arrive as binary JPEG messages and
 * are passed to the SDK in memory. Nothing about the picture is written to
 * the database or the log.
 */
export function attachCheckinSocket(server: Server, store: Store, config: Config): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/checkin', maxPayload: 700_000 });
  wss.on('connection', (socket, request) => {
    handleConnection(socket, request, store, config);
  });
  return wss;
}

function handleConnection(
  socket: WebSocket,
  request: IncomingMessage,
  store: Store,
  config: Config,
): void {
  const token = readCookie(request.headers.cookie, 'nn_session');
  const session = token ? store.sessionFromToken(token) : null;
  if (!session) {
    send(socket, { type: 'error', message: 'Come in with the house word and PIN first.' });
    socket.close(1008, 'auth');
    return;
  }
  const household = store.householdById(session.householdId);
  if (!household) {
    send(socket, { type: 'error', message: 'That house is no longer here.' });
    socket.close(1008, 'auth');
    return;
  }

  let helloSeen = false;
  let checkinId: string | null = null;
  let consentId: string | null = null;
  let memberId: string | null = null;
  let memberName = 'They';
  let mood: Mood | null = null;
  let note: string | null = null;
  let live: SdkHost | null = null;
  let finalized = false;
  let framesThisSecond = 0;
  let secondStarted = Date.now();
  let dropped = 0;
  const startedAtMs = Date.now();
  let capTimer: NodeJS.Timeout | null = null;

  const helloTimer = setTimeout(() => {
    if (!helloSeen) {
      send(socket, { type: 'error', message: 'The check-in did not start. You can try again.' });
      socket.close(1008, 'hello');
    }
  }, 10_000);

  async function finalize(reason: 'finish' | 'drop' | 'cap' | 'withdraw'): Promise<void> {
    if (finalized) return;
    finalized = true;
    clearTimeout(helloTimer);
    if (capTimer) clearTimeout(capTimer);
    const sessionLive = live;
    const id = checkinId;
    try {
      if (sessionLive && id) {
        await sessionLive.pullSummary();
        const kept = sessionLive.snapshot.kept;
        const covered = sessionLive.keptCoverage();
        const endedAt = new Date();
        if (reason === 'withdraw' && consentId) store.withdrawConsent(household!.id, consentId);
        store.finishCheckin(id, household!.id, {
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - startedAtMs,
          mood,
          note,
          pulse: kept.pulse?.value ?? null,
          pulseConfidence: kept.pulse?.confidence ?? null,
          breathing: kept.breathing?.value ?? null,
          breathingConfidence: kept.breathing?.confidence ?? null,
          hrvRmssd: kept.hrv?.rmssd ?? null,
          hrvSdnn: kept.hrv?.sdnn ?? null,
          hrvMeanNn: kept.hrv?.meanNn ?? null,
          hrvConfidence: kept.hrv?.confidence ?? null,
          expressionWords: kept.expression?.words ?? null,
          validationOkRatio: sessionLive.validationRatio(),
          pulseValidSeconds: covered.pulse.validSeconds,
          breathingValidSeconds: covered.breathing.validSeconds,
          hrvValidSeconds: covered.hrv.validSeconds,
          pulseSamples: covered.pulse.samples,
          breathingSamples: covered.breathing.samples,
          hrvSamples: covered.hrv.samples,
          endedReason: reason,
          trace: sessionLive.keptTrace(),
        });
        if ((reason === 'finish' || reason === 'withdraw') && memberId) {
          const member = store.member(household!.id, memberId);
          const rows = store.checkinsFor(household!.id, memberId);
          const story = buildStory(member?.displayName ?? memberName, rows);
          send(socket, {
            type: 'result',
            checkinId: id,
            mood,
            note,
            pulse: kept.pulse,
            breathing: kept.breathing,
            hrv: kept.hrv,
            expression: kept.expression,
            coverage: sessionLive.coverageSnapshot(),
            endedReason: reason,
            verdict: story.latest?.verdict ?? null,
            disclaimer: NOT_A_MEDICAL_DEVICE,
          });
        }
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'check-in save failed',
      );
      send(socket, { type: 'error', message: 'The check-in ended, but the record did not save.' });
    } finally {
      try {
        await sessionLive?.close();
      } finally {
        if (id) releaseSdk(id);
        if (socket.readyState === WebSocket.OPEN) socket.close(1000, reason);
      }
    }
  }

  async function begin(body: { memberId: string; consentId: string }): Promise<void> {
    const member = store.member(household!.id, body.memberId);
    if (!member || member.role !== 'person') {
      send(socket, { type: 'error', message: 'We could not find that person in this house.' });
      socket.close(1008, 'member');
      return;
    }
    const consent = store.freshConsent(
      household!.id,
      member.id,
      body.consentId,
      CONSENT_MAX_AGE_MS,
    );
    if (!consent) {
      send(socket, {
        type: 'error',
        message: 'The agreement is missing or old. Read it again, then start.',
      });
      socket.close(1008, 'consent');
      return;
    }
    if (!config.apiKey) {
      send(socket, {
        type: 'error',
        message:
          'This server has no Presage key yet, so the camera check-in cannot start. The sample check-in still can.',
      });
      socket.close(1008, 'key');
      return;
    }

    memberId = member.id;
    memberName = member.displayName;
    const id = randomUUID();
    try {
      live = await guardedOpen(id, {
        apiKey: config.apiKey,
        telemetry: config.telemetry,
        startupTimeoutMs: config.startupTimeoutMs,
      });
    } catch (err) {
      const startup = err instanceof SdkStartupError ? err : null;
      const message = err instanceof Error ? err.message : 'The measurement did not start.';
      logger.warn({ err: message }, 'live session did not start');
      send(socket, {
        type: 'error',
        code: startup?.code ?? 'presage',
        message,
      });
      socket.close(1013, startup?.code ?? 'presage');
      return;
    }
    checkinId = id;

    try {
      store.beginCheckin({
        id,
        householdId: household!.id,
        memberId: member.id,
        mode: 'live',
        startedAt: new Date().toISOString(),
      });
      if (mood || note) store.touchCheckin(id, household!.id, { mood, note });

      live.onUpdate((message) => {
        send(socket, message);
        if (message.type === 'sdk_error' && message.code === 'presage') void finalize('drop');
      });
      if (finalized || socket.readyState !== WebSocket.OPEN) {
        await live.close();
        releaseSdk(id);
        live = null;
        checkinId = null;
        return;
      }
      capTimer = setTimeout(() => {
        send(socket, {
          type: 'error',
          message:
            'This check-in reached three minutes, so the camera service stopped. A shorter sit is plenty.',
        });
        void finalize('cap');
      }, SESSION_CAP_MS);
      send(socket, { type: 'started', checkinId: id, mode: 'live' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The measurement did not start.';
      logger.warn({ err: message }, 'live session did not start');
      send(socket, { type: 'error', message });
      await finalize('drop');
    }
  }

  socket.on('message', (data, isBinary) => {
    if (finalized) return;
    if (isBinary) {
      if (!live || !checkinId) return;
      const now = Date.now();
      if (now - secondStarted >= 1000) {
        if (dropped > 0) {
          logger.debug({ dropped, forwarded: framesThisSecond }, 'frames dropped for pace');
        }
        framesThisSecond = 0;
        dropped = 0;
        secondStarted = now;
      }
      if (framesThisSecond >= FRAME_CAP_PER_SEC) {
        dropped += 1;
        return;
      }
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const frame = parseFrame(buffer);
      if (!frame) {
        dropped += 1;
        return;
      }
      framesThisSecond += 1;
      const result = live.pushJpeg(frame.jpeg, frame.timestampUs);
      if (!result.ok && result.reason !== 'timestamp') dropped += 1;
      return;
    }

    const text = typeof data === 'string' ? data : data.toString('utf8');
    if (text.length > 8000) return;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return;
    }
    if (!body || typeof body !== 'object') return;
    const type = (body as { type?: unknown }).type;

    if (!helloSeen) {
      if (type !== 'hello') return;
      const member = (body as { memberId?: unknown }).memberId;
      const agreed = (body as { consentId?: unknown }).consentId;
      if (typeof member !== 'string' || typeof agreed !== 'string') {
        send(socket, { type: 'error', message: 'The check-in was missing who it is for.' });
        socket.close(1008, 'hello');
        return;
      }
      helloSeen = true;
      consentId = agreed;
      clearTimeout(helloTimer);
      void begin({ memberId: member, consentId: agreed });
      return;
    }

    if (type === 'mood' && isMood((body as { mood?: unknown }).mood)) {
      mood = (body as { mood: Mood }).mood;
      if (checkinId) store.touchCheckin(checkinId, household!.id, { mood });
      return;
    }
    if (type === 'note') {
      note = cleanNote((body as { note?: unknown }).note);
      if (checkinId) store.touchCheckin(checkinId, household!.id, { note });
      return;
    }
    if (type === 'finish') {
      void finalize('finish');
      return;
    }
    if (type === 'withdraw') {
      if (consentId) store.withdrawConsent(household.id, consentId);
      send(socket, {
        type: 'withdrawn',
        message:
          'Agreement withdrawn. The camera is off. Days already kept are still here until you delete them.',
      });
      void finalize('withdraw');
    }
  });

  socket.on('close', () => {
    void finalize('drop');
  });

  socket.on('error', (err) => {
    logger.warn({ err: err.message }, 'check-in socket error');
    void finalize('drop');
  });
}
