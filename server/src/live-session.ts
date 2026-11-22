import { logger } from './logger.js';
import { emptyCoverage, freshSeen, recordSample, type SittingCoverage } from './coverage.js';
import {
  applyMetrics,
  BREATHING_KEEP_MIN,
  emptySnapshot,
  HRV_KEEP_MIN,
  PULSE_KEEP_MIN,
  publicSignals,
  type SignalSnapshot,
} from './metrics.js';
import { acceptTimestamp, jpegToRgb } from './frames.js';
import {
  friendlySdkError,
  isBenignSdkNoise,
  loadSdk,
  type LoadedSdk,
  type SdkInstance,
} from './sdk.js';

export interface TracePoint {
  t: number;
  pulse: number | null;
  breath: number | null;
}

export interface LiveUpdate {
  type: 'signals' | 'processing' | 'sdk_error' | 'validation';
  [key: string]: unknown;
}

/**
 * One SmartSpectra session fed by phone frames.
 * Frames are decoded in memory and handed to sendFrame. They are not stored.
 * LLM Insights (`requestInsight`) is never called.
 */
export class LiveSession {
  private sdk: SdkInstance | null = null;
  private loaded: LoadedSdk | null = null;
  private closed = false;
  private framesFailed = false;
  private framesSent = 0;
  private lastTs = -1;
  private validationOk = 0;
  private validationTotal = 0;
  private validation = { code: 0, hint: '' };
  private trace: TracePoint[] = [];
  private lastTraceAt = 0;
  private coverage: SittingCoverage = emptyCoverage();
  private seenSeconds = freshSeen();
  private lastEmitAt = 0;
  private readonly startedAt = Date.now();
  private readonly listeners = new Set<(message: LiveUpdate) => void>();
  snapshot: SignalSnapshot = emptySnapshot();

  constructor(
    private readonly apiKey: string,
    private readonly telemetry: boolean,
  ) {}

  onUpdate(listener: (message: LiveUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(message: LiveUpdate): void {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'listener failed');
      }
    }
  }

  async open(): Promise<void> {
    const loaded = await loadSdk();
    if (!loaded) {
      throw new Error('The measurement library is not available on this server.');
    }
    this.loaded = loaded;
    const sdk = new loaded.SmartSpectraSDK({
      apiKey: this.apiKey,
      requestedMetrics: [
        ...loaded.breathingMetrics,
        loaded.MetricType.PULSE_RATE,
        loaded.MetricType.HRV,
        loaded.MetricType.EXPRESSIONS,
        loaded.MetricType.TALKING,
      ],
      enableTelemetry: this.telemetry,
      enableAccumulatedOutput: true,
      logLevel: loaded.SmartSpectraLogLevel.kWarning,
    });
    this.sdk = sdk;

    sdk.on('metrics', (buf: Buffer) => {
      this.ingest(buf);
    });
    sdk.on('accumulatedMetrics', (buf: Buffer) => {
      this.ingest(buf);
    });
    sdk.on('validationStatus', (code: number, _timestampUs: number, hint: string) => {
      this.validationTotal += 1;
      if (code === 0) this.validationOk += 1;
      const next = { code, hint: typeof hint === 'string' ? hint : '' };
      const changed = next.code !== this.validation.code;
      this.validation = next;
      if (changed) {
        logger.info({ code: next.code, hint: next.hint }, 'validation status');
        this.emit({ type: 'validation', ...next });
        this.emitSignals(true);
      }
    });
    sdk.on('processingStatus', (status: number) => {
      logger.info({ status }, 'processing status');
      this.emit({ type: 'processing', status });
    });
    sdk.on('error', (code: number, message: string, retryable: boolean) => {
      // Vulkan, MediaPipe tensor notes, and the model-path fallback are native
      // log lines. They are not a failed check-in. A machine without a GPU
      // still measures pulse and breathing.
      if (isBenignSdkNoise(message)) {
        logger.info({ code, message }, 'smartspectra notice, not shown');
        return;
      }
      logger.warn({ code, message, retryable }, 'smartspectra session error');
      this.emit({
        type: 'sdk_error',
        code,
        retryable,
        message: friendlySdkError(code),
      });
    });

    sdk.useCustomInput(loaded.FrameTransform.kNone);

    if (typeof sdk.checkDeviceReadiness === 'function') {
      try {
        const readiness = await sdk.checkDeviceReadiness();
        logger.info({ verdict: readiness.verdict }, 'device readiness');
        if (readiness.verdict === 'blocked') {
          throw new Error('This server cannot run a measurement right now.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('cannot run a measurement')) throw err;
        // Custom input has no local camera. A readiness miss should not block
        // a check-in the phone is about to feed.
        logger.warn({ err: message }, 'device readiness check did not complete');
      }
    }

    sdk.start();
  }

  private ingest(buf: Buffer): void {
    if (!this.loaded || this.closed) return;
    try {
      const decoded = this.loaded.decodeMetrics(buf);
      this.snapshot = applyMetrics(this.snapshot, decoded);
      const now = Date.now();
      const second = Math.floor((now - this.startedAt) / 1000);
      if (this.snapshot.pulse) {
        recordSample(
          this.coverage,
          this.seenSeconds,
          'pulse',
          now,
          second,
          this.snapshot.pulse.confidence,
          PULSE_KEEP_MIN,
        );
      }
      if (this.snapshot.breathing) {
        recordSample(
          this.coverage,
          this.seenSeconds,
          'breathing',
          now,
          second,
          this.snapshot.breathing.confidence,
          BREATHING_KEEP_MIN,
        );
      }
      if (this.snapshot.hrv) {
        recordSample(
          this.coverage,
          this.seenSeconds,
          'hrv',
          now,
          second,
          this.snapshot.hrv.confidence,
          HRV_KEEP_MIN,
        );
      }
      if (now - this.lastTraceAt >= 1000) {
        this.lastTraceAt = now;
        const pulse =
          this.snapshot.pulse && this.snapshot.pulse.confidence > 0
            ? this.snapshot.pulse.value
            : null;
        const breath =
          this.snapshot.breathing && this.snapshot.breathing.confidence > 0
            ? this.snapshot.breathing.value
            : null;
        // Keep the gap. A null is not a zero, and the chart must not join across it.
        if (pulse !== null || breath !== null) {
          this.trace.push({ t: now - this.startedAt, pulse, breath });
          if (this.trace.length > 40) this.trace.shift();
        }
      }
      this.emitSignals(false);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'metrics decode failed',
      );
    }
  }

  private emitSignals(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastEmitAt < 250) return;
    this.lastEmitAt = now;
    this.emit({
      ...publicSignals(this.snapshot, this.validation),
      elapsedMs: now - this.startedAt,
      coverage: this.coverageSnapshot(now),
    });
  }

  coverageSnapshot(now = Date.now()) {
    const age = (at: number | null) => (at === null ? null : Math.max(0, now - at));
    return {
      elapsedSeconds: Math.floor((now - this.startedAt) / 1000),
      pulse: { ...this.coverage.pulse, ageMs: age(this.coverage.pulse.lastAtMs) },
      breathing: { ...this.coverage.breathing, ageMs: age(this.coverage.breathing.lastAtMs) },
      hrv: { ...this.coverage.hrv, ageMs: age(this.coverage.hrv.lastAtMs) },
    };
  }

  async pushJpeg(jpegBytes: Buffer, timestampUs: number): Promise<{ ok: boolean; reason: string }> {
    if (this.closed || !this.sdk || !this.loaded) return { ok: false, reason: 'closed' };
    if (!acceptTimestamp(this.lastTs, timestampUs)) return { ok: false, reason: 'timestamp' };
    const frame = await jpegToRgb(jpegBytes);
    if (!frame) return { ok: false, reason: 'decode' };
    this.lastTs = timestampUs;
    // Packed RGB, not RGBA. Stride is width * 3. timestampUs is monotonic
    // microseconds (the phone's performance clock), the same contract as
    // Number(process.hrtime.bigint() / 1000n) on a local probe: strictly
    // increasing, not wall-clock. A 640x480 frame is stride 1920.
    if (frame.rgb.length !== frame.width * frame.height * 3) return { ok: false, reason: 'decode' };
    const stride = frame.width * 3;
    let sent: boolean;
    try {
      sent = this.sdk.sendFrame(
        frame.rgb,
        frame.width,
        frame.height,
        stride,
        this.loaded.PixelFormat.kRGB,
        timestampUs,
      );
    } catch (err) {
      // After a terminal SDK error (kProcessingFailed, kSustainedLowFrameRate)
      // sendFrame throws "not in a valid state". The 'error' event has already
      // told the phone. Stop feeding instead of crashing the child.
      if (!this.framesFailed) {
        this.framesFailed = true;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), framesSent: this.framesSent },
          'sendFrame refused, no more frames this sitting',
        );
      }
      return { ok: false, reason: 'rejected' };
    }
    if (sent) {
      this.framesSent += 1;
      if (this.framesSent === 1) {
        logger.info({ width: frame.width, height: frame.height }, 'first frame reached the sdk');
      }
      if (this.framesSent % 300 === 0) {
        const seconds = (Date.now() - this.startedAt) / 1000;
        logger.info(
          {
            framesSent: this.framesSent,
            fps: Number((this.framesSent / seconds).toFixed(1)),
            validation: this.validation.code,
            pulse: this.snapshot.pulse?.value ?? null,
            breathing: this.snapshot.breathing?.value ?? null,
          },
          'live session progress',
        );
      }
    }
    return sent ? { ok: true, reason: 'sent' } : { ok: false, reason: 'rejected' };
  }

  keptTrace(): TracePoint[] {
    return this.trace.filter((point) => point.pulse !== null || point.breath !== null);
  }

  keptCoverage(): SittingCoverage {
    return this.coverage;
  }

  validationRatio(): number | null {
    if (this.validationTotal === 0) return null;
    return this.validationOk / this.validationTotal;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const sdk = this.sdk;
    this.sdk = null;
    if (!sdk) return;
    try {
      await sdk.stopAsync();
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'sdk stop failed');
    }
    try {
      await sdk.destroy();
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'sdk destroy failed');
    }
  }
}
