import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emptyCoverage, type SittingCoverage } from './coverage.js';
import { emptySnapshot, type SignalSnapshot } from './metrics.js';
import { acceptTimestamp } from './frames.js';
import { logger } from './logger.js';
import { isBenignSdkNoise, releaseSdk, tryHoldSdk } from './sdk.js';
import type { TracePoint } from './live-session.js';

export const BUSY_MESSAGE =
  'Someone else is checking in. Try again shortly. This server can watch one person at a time.';

export const PRESAGE_UNREACHABLE =
  "Couldn't reach Presage. Check the API key, then try again. The sample check-in still works.";

export class SdkStartupError extends Error {
  constructor(
    message: string,
    readonly code: 'presage' | 'busy' | 'library',
  ) {
    super(message);
    this.name = 'SdkStartupError';
  }
}

/** The slice of a child process the host needs. Tests pass a fake. */
export interface SdkChild {
  send(message: unknown): boolean | void;
  kill(signal?: NodeJS.Signals | number): boolean | void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

export interface SdkHostOptions {
  apiKey: string;
  telemetry: boolean;
  startupTimeoutMs: number;
  spawn?: () => SdkChild;
}

interface PublicCoverage {
  elapsedSeconds: number;
  pulse: { samples: number; validSeconds: number; lastAtMs: number | null; ageMs: number | null };
  breathing: { samples: number; validSeconds: number; lastAtMs: number | null; ageMs: number | null };
  hrv: { samples: number; validSeconds: number; lastAtMs: number | null; ageMs: number | null };
}

interface SummaryMessage {
  type: 'summary';
  kept: SignalSnapshot['kept'] | null;
  coverage: SittingCoverage | null;
  publicCoverage?: PublicCoverage | null;
  trace: TracePoint[];
  validationRatio: number | null;
}

/**
 * Talks to one SDK child process. Construction, auth, start, frames, and
 * metric decoding all happen in that process. If it never answers, this
 * kills it and leaves the main thread free.
 */
export class SdkHost {
  private child: SdkChild | null = null;
  private lastTs = -1;
  private opened = false;
  private destroyed = false;
  /** A stop or a kill we asked for. The child's exit is not a Presage failure. */
  private quietExit = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private summaryResolve: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(message: Record<string, unknown>) => void>();
  snapshot: SignalSnapshot = emptySnapshot();
  private coverage: SittingCoverage = emptyCoverage();
  private trace: TracePoint[] = [];
  private ratio: number | null = null;
  private publicCoverage: PublicCoverage | null = null;

  constructor(private readonly options: SdkHostOptions) {}

  onUpdate(listener: (message: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(message: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'listener failed');
      }
    }
  }

  async open(): Promise<void> {
    if (this.opened || this.destroyed) return;
    const child = (this.options.spawn ?? forkSdkChild)();
    this.child = child;
    child.on('message', (message) => this.onMessage(message));
    child.on('exit', () => this.onExit());
    child.send({
      type: 'open',
      apiKey: this.options.apiKey,
      telemetry: this.options.telemetry,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
        this.timer = setTimeout(() => {
          this.rejectReady(new SdkStartupError(PRESAGE_UNREACHABLE, 'presage'));
        }, this.options.startupTimeoutMs);
      });
      this.opened = true;
    } catch (err) {
      this.destroy();
      throw err;
    }
  }

  pushJpeg(jpeg: Buffer, timestampUs: number): { ok: boolean; reason: string } {
    if (!this.opened || !this.child || this.destroyed) return { ok: false, reason: 'closed' };
    if (!acceptTimestamp(this.lastTs, timestampUs)) return { ok: false, reason: 'timestamp' };
    this.lastTs = timestampUs;
    try {
      const sent = this.child.send({ type: 'frame', jpeg, timestampUs });
      if (sent === false) return { ok: false, reason: 'closed' };
    } catch {
      return { ok: false, reason: 'closed' };
    }
    return { ok: true, reason: 'queued' };
  }

  /** Ask the child for the numbers it kept. Safe to call if the child is already gone. */
  async pullSummary(): Promise<void> {
    await this.waitForSummary(3000);
  }

  async close(): Promise<void> {
    this.quietExit = true;
    if (this.child && !this.destroyed && this.opened) {
      try {
        this.child.send({ type: 'stop' });
      } catch {
        this.destroy();
        return;
      }
      await this.waitForSummary(4000);
    }
    this.destroy();
  }

  private waitForSummary(timeoutMs: number): Promise<void> {
    if (!this.child || this.destroyed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.summaryResolve = null;
        resolve();
      }, timeoutMs);
      timer.unref?.();
      this.summaryResolve = () => {
        clearTimeout(timer);
        this.summaryResolve = null;
        resolve();
      };
      try {
        const sent = this.child?.send({ type: 'summary' });
        if (sent === false) {
          clearTimeout(timer);
          this.summaryResolve = null;
          resolve();
        }
      } catch {
        clearTimeout(timer);
        this.summaryResolve = null;
        resolve();
      }
    });
  }

  keptCoverage(): SittingCoverage {
    return this.coverage;
  }

  keptTrace(): TracePoint[] {
    return this.trace;
  }

  validationRatio(): number | null {
    return this.ratio;
  }

  coverageSnapshot(now = Date.now()): PublicCoverage {
    if (this.publicCoverage) return this.publicCoverage;
    const age = (at: number | null) => (at === null ? null : Math.max(0, now - at));
    return {
      elapsedSeconds: 0,
      pulse: { ...this.coverage.pulse, ageMs: age(this.coverage.pulse.lastAtMs) },
      breathing: { ...this.coverage.breathing, ageMs: age(this.coverage.breathing.lastAtMs) },
      hrv: { ...this.coverage.hrv, ageMs: age(this.coverage.hrv.lastAtMs) },
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.quietExit = true;
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }

  private onMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const body = message as { type?: string };
    if (body.type === 'ready') {
      this.resolveReady();
      return;
    }
    if (body.type === 'failed') {
      const text =
        typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : PRESAGE_UNREACHABLE;
      const kind = (body as { kind?: string }).kind;
      const code = kind === 'library' ? 'library' : 'presage';
      this.rejectReady(new SdkStartupError(text, code));
      return;
    }
    if (body.type === 'summary') {
      this.applySummary(body as SummaryMessage);
      this.summaryResolve?.();
      this.summaryResolve = null;
      return;
    }
    if (body.type === 'sdk_error') {
      const text =
        typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : '';
      if (isBenignSdkNoise(text)) return;
    }
    if (
      body.type === 'signals' ||
      body.type === 'validation' ||
      body.type === 'sdk_error' ||
      body.type === 'processing'
    ) {
      this.emit(body as Record<string, unknown>);
    }
  }

  private applySummary(message: SummaryMessage): void {
    if (message.kept) this.snapshot = { ...this.snapshot, kept: message.kept };
    if (message.coverage) this.coverage = message.coverage;
    if (message.publicCoverage) this.publicCoverage = message.publicCoverage;
    if (Array.isArray(message.trace)) this.trace = message.trace;
    this.ratio = message.validationRatio ?? null;
  }

  private resolveReady(): void {
    if (!this.readyResolve) return;
    if (this.timer) clearTimeout(this.timer);
    const resolve = this.readyResolve;
    this.readyResolve = null;
    this.readyReject = null;
    resolve();
  }

  private rejectReady(err: Error): void {
    if (!this.readyReject) return;
    if (this.timer) clearTimeout(this.timer);
    const reject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    reject(err);
  }

  private onExit(): void {
    if (this.quietExit || this.destroyed) return;
    if (this.readyReject) {
      this.rejectReady(new SdkStartupError(PRESAGE_UNREACHABLE, 'presage'));
      return;
    }
    if (this.opened) {
      this.emit({
        type: 'sdk_error',
        code: 'presage',
        message: PRESAGE_UNREACHABLE,
        retryable: true,
      });
    }
  }
}

/**
 * One measurement at a time. On timeout or Presage failure the child is
 * killed and the lock is released, so the sample house and the next
 * check-in are not stuck behind it.
 */
export async function guardedOpen(id: string, options: SdkHostOptions): Promise<SdkHost> {
  if (!tryHoldSdk(id)) throw new SdkStartupError(BUSY_MESSAGE, 'busy');
  const host = new SdkHost(options);
  try {
    await host.open();
    return host;
  } catch (err) {
    await host.close();
    releaseSdk(id);
    throw err;
  }
}

export function forkSdkChild(): ChildProcess {
  const compiled = fileURLToPath(new URL('./sdk-child.js', import.meta.url));
  const source = fileURLToPath(new URL('./sdk-child.ts', import.meta.url));
  const script = existsSync(compiled) ? compiled : source;
  return fork(script, [], {
    execArgv: script.endsWith('.ts') ? ['--import', 'tsx'] : [],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}
