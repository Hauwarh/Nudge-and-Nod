/**
 * SmartSpectra runs here, not in the HTTP process. If the constructor or
 * start() blocks inside the native library, the parent kills this process
 * and keeps serving the sample house.
 *
 * Frames are decoded in memory and passed to sendFrame. They are not written
 * anywhere. LLM Insights are never called.
 */
import { LiveSession } from './live-session.js';
import { friendlySdkError } from './sdk.js';

const UNREACHABLE =
  "Couldn't reach Presage. Check the API key, then try again. The sample check-in still works.";

function send(message: unknown): void {
  if (typeof process.send === 'function') process.send(message);
}

let session: LiveSession | null = null;
let stopping = false;

function fail(kind: 'presage' | 'library', message: string): void {
  send({ type: 'failed', kind, message });
}

async function open(apiKey: string, telemetry: boolean): Promise<void> {
  session = new LiveSession(apiKey, telemetry);
  session.onUpdate((update) => send(update));
  try {
    await session.open();
    send({ type: 'ready' });
  } catch (err) {
    const described = describeFailure(err);
    fail(described.kind, described.message);
  }
}

function describeFailure(err: unknown): { kind: 'presage' | 'library'; message: string } {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('not available')) return { kind: 'library', message };
  const code =
    typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null;
  if (code === 2 || code === 4 || code === 5 || code === 6) {
    return { kind: 'presage', message: friendlySdkError(code) };
  }
  return { kind: 'presage', message: UNREACHABLE };
}

function summary(): void {
  if (!session) {
    send({ type: 'summary', kept: null, coverage: null, trace: [], validationRatio: null });
    return;
  }
  send({
    type: 'summary',
    kept: session.snapshot.kept,
    coverage: session.keptCoverage(),
    publicCoverage: session.coverageSnapshot(),
    trace: session.keptTrace(),
    validationRatio: session.validationRatio(),
  });
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  summary();
  try {
    await session?.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The measurement stopped.';
    send({ type: 'sdk_error', code: 'presage', message, retryable: true });
  }
  process.exit(0);
}

process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object') return;
  const body = message as {
    type?: string;
    apiKey?: string;
    telemetry?: boolean;
    jpeg?: Buffer;
    timestampUs?: number;
  };
  if (body.type === 'open' && typeof body.apiKey === 'string') {
    void open(body.apiKey, Boolean(body.telemetry));
    return;
  }
  if (
    body.type === 'frame' &&
    session &&
    Buffer.isBuffer(body.jpeg) &&
    typeof body.timestampUs === 'number'
  ) {
    session.pushJpeg(body.jpeg, body.timestampUs);
    return;
  }
  if (body.type === 'summary') {
    summary();
    return;
  }
  if (body.type === 'stop') {
    void stop();
  }
});
