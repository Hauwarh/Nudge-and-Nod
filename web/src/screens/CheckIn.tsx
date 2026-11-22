import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { type MoodId } from '../copy';
import { clock, whole } from '../format';
import type { HrvMeasure, Measure, Verdict } from '../types';
import { MoodBoard } from '../components/MoodBoard';
import { Disclaimer, Shell, VerdictLabel } from '../components/ui';

interface FaceGlance {
  words: string;
  confidence: number;
}

interface Signals {
  pulse: Measure | null;
  breathing: Measure | null;
  hrv: HrvMeasure | null;
  expression: FaceGlance | null;
  talking: boolean;
  pulseTrace: number | null;
  breathTrace: number | null;
  validation: { code: number; hint: string };
  coverage?: Coverage | null;
}

interface Coverage {
  elapsedSeconds: number;
  pulse: { samples: number; validSeconds: number; ageMs: number | null };
  breathing: { samples: number; validSeconds: number; ageMs: number | null };
  hrv: { samples: number; validSeconds: number; ageMs: number | null };
}

const EMPTY: Signals = {
  pulse: null,
  breathing: null,
  hrv: null,
  expression: null,
  talking: false,
  pulseTrace: null,
  breathTrace: null,
  validation: { code: 0, hint: '' },
};

function guide(elapsedMs: number, talking: boolean): string {
  if (talking) return 'If you can, pause speaking. It muddles the breathing.';
  if (elapsedMs < 8000) return 'Let the phone see your face and the top of your chest.';
  if (elapsedMs < 16000) return 'Still and quiet is enough. Pulse usually appears around now.';
  if (elapsedMs < 30000) return 'Breathing takes a little longer. You are doing fine.';
  if (elapsedMs < 55000)
    return 'When you are ready, tap the picture that fits. Or stay for the minute.';
  return 'Beat-to-beat variation usually needs about a minute. You can stop whenever you like.';
}

function visibleHint(signals: Signals, elapsedMs: number): string {
  if (signals.validation.code !== 0 && signals.validation.hint.trim())
    return signals.validation.hint.trim();
  if (!signals.pulse) {
    return 'Looking for a face. Come closer, with the light on your face, and hold still.';
  }
  return guide(elapsedMs, signals.talking);
}

function sampleSignals(elapsedMs: number): Signals {
  const wobble = Math.sin(elapsedMs / 900);
  return {
    pulse:
      elapsedMs >= 12000
        ? { value: Math.round((72 + wobble * 1.2) * 10) / 10, confidence: 64, stable: true }
        : null,
    breathing: elapsedMs >= 30000 ? { value: 14, confidence: 58, stable: true } : null,
    hrv:
      elapsedMs >= 60000
        ? { rmssd: 34, sdnn: 42, meanNn: 830, confidence: 55, stable: true }
        : null,
    expression: elapsedMs > 8000 ? { words: 'a quiet face', confidence: 50 } : null,
    talking: false,
    pulseTrace: elapsedMs >= 12000 ? Math.sin(elapsedMs / 140) : null,
    breathTrace: elapsedMs >= 30000 ? Math.sin((elapsedMs / 4300) * Math.PI * 2) : null,
    validation: { code: 0, hint: '' },
    coverage: sampleCoverage(elapsedMs),
  };
}

function steadySeconds(elapsedMs: number, startsAtMs: number): number {
  if (elapsedMs < startsAtMs) return 0;
  return Math.floor(elapsedMs / 1000) - Math.floor(startsAtMs / 1000) + 1;
}

function sampleCoverage(elapsedMs: number): Coverage {
  const seconds = Math.floor(elapsedMs / 1000);
  const pulseValid = steadySeconds(elapsedMs, 12_000);
  const breathValid = steadySeconds(elapsedMs, 30_000);
  const hrvValid = steadySeconds(elapsedMs, 60_000);
  return {
    elapsedSeconds: seconds,
    pulse: { samples: pulseValid, validSeconds: pulseValid, ageMs: pulseValid > 0 ? 200 : null },
    breathing: {
      samples: breathValid,
      validSeconds: breathValid,
      ageMs: breathValid > 0 ? 200 : null,
    },
    hrv: { samples: hrvValid, validSeconds: hrvValid, ageMs: hrvValid > 0 ? 200 : null },
  };
}

function quality(kind: 'pulse' | 'breathing' | 'hrv', confidence: number): string {
  const mark = kind === 'pulse' ? 40 : kind === 'breathing' ? 45 : 50;
  return confidence >= mark ? 'Steady enough to keep' : 'Still unsteady';
}

export function CheckIn({
  name,
  mode,
  consentId,
  memberId,
  onLeave,
  onStory,
}: {
  name: string;
  mode: 'live' | 'sample';
  consentId: string | null;
  memberId: string;
  onLeave: () => void;
  onStory: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const running = useRef(true);
  const [signals, setSignals] = useState<Signals>(EMPTY);
  const [elapsed, setElapsed] = useState(0);
  const [mood, setMood] = useState<MoodId | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<'run' | 'result' | 'error'>('run');
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [saved, setSaved] = useState(false);
  const [breathSpread, setBreathSpread] = useState<number | null>(null);
  const traceSpan = useRef({ min: 0, max: 0, seen: false });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    running.current = true;
    const started = performance.now();
    const timer = window.setInterval(() => {
      if (!running.current) return;
      setElapsed(performance.now() - started);
    }, 250);

    let wake: WakeLockSentinel | null = null;
    const stopCamera = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      void wake?.release();
    };

    const abort = new AbortController();

    async function runSample() {
      while (!abort.signal.aborted && running.current) {
        const ms = performance.now() - started;
        const next = sampleSignals(ms);
        setSignals(next);
        if (next.breathing && next.breathing.confidence > 0) applyTrace(next.breathTrace);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    function applyTrace(value: number | null) {
      if (value === null || !Number.isFinite(value)) return;
      const span = traceSpan.current;
      if (!span.seen) {
        span.min = value;
        span.max = value;
        span.seen = true;
      } else {
        span.min = Math.min(span.min, value);
        span.max = Math.max(span.max, value);
      }
      const range = span.max - span.min;
      const amount = range < 1e-4 ? 0.5 : (value - span.min) / range;
      setBreathSpread(6 + amount * 12);
    }

    async function runLive() {
      if (!window.isSecureContext) {
        setError('The camera needs a secure page. Open the https address.');
        setPhase('error');
        return;
      }
      if (!consentId) {
        setError('The agreement is missing. Go back and read it again.');
        setPhase('error');
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'user' },
          });
        } catch (err) {
          const nameOf = err instanceof DOMException ? err.name : '';
          const message =
            nameOf === 'NotAllowedError'
              ? 'The browser did not get permission to use the camera. You can allow it in the address bar, or use the sample check-in.'
              : nameOf === 'NotFoundError'
                ? 'No camera was found on this phone.'
                : 'The camera could not be opened. It may be in use by another app.';
          setError(message);
          setPhase('error');
          return;
        }
      }
      if (abort.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      try {
        wake = await navigator.wakeLock?.request('screen');
      } catch {
        wake = null;
      }

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws/checkin`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      const origin = performance.now();

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello', memberId, consentId }));
      };
      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (body.type === 'signals') {
          const next: Signals = {
            pulse: (body.pulse as Measure | null) ?? null,
            breathing: (body.breathing as Measure | null) ?? null,
            hrv: (body.hrv as HrvMeasure | null) ?? null,
            expression: (body.expression as FaceGlance | null) ?? null,
            talking: Boolean(body.talking),
            pulseTrace: typeof body.pulseTrace === 'number' ? body.pulseTrace : null,
            breathTrace: typeof body.breathTrace === 'number' ? body.breathTrace : null,
            validation: (body.validation as Signals['validation']) ?? { code: 0, hint: '' },
            coverage: (body.coverage as Coverage | null) ?? null,
          };
          setSignals(next);
          if (next.breathing && next.breathing.confidence > 0) applyTrace(next.breathTrace);
        } else if (body.type === 'validation' && body.hint) {
          setSignals((current) => ({
            ...current,
            validation: { code: Number(body.code) || 0, hint: String(body.hint) },
          }));
        } else if (body.type === 'result') {
          running.current = false;
          stopCamera();
          setVerdict((body.verdict as Verdict | null) ?? null);
          setSaved(true);
          setPhase('result');
        } else if (body.type === 'withdrawn') {
          running.current = false;
          stopCamera();
          setError(
            typeof body.message === 'string'
              ? body.message
              : 'Agreement withdrawn. The camera is off.',
          );
          setPhase('error');
        } else if (body.type === 'error') {
          running.current = false;
          stopCamera();
          setError(typeof body.message === 'string' ? body.message : 'The check-in stopped.');
          setPhase('error');
        } else if (
          body.type === 'sdk_error' ||
          (body.type === 'error' && body.code === 'presage')
        ) {
          running.current = false;
          stopCamera();
          setError(
            typeof body.message === 'string'
              ? body.message
              : "Couldn't reach Presage. Check the API key, then try again. The sample check-in still works.",
          );
          setPhase('error');
        }
      };
      ws.onclose = () => {
        stopCamera();
        if (running.current) {
          running.current = false;
          setError(
            'The connection closed and the camera is off. If a steady number had already arrived, it was kept with the day.',
          );
          setPhase('error');
        }
      };

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      let busy = false;
      let last = 0;
      const tick = async (time: number) => {
        if (!running.current || abort.signal.aborted) return;
        if (
          !busy &&
          time - last >= 1000 / 30 &&
          ws.readyState === WebSocket.OPEN &&
          videoRef.current
        ) {
          const video = videoRef.current;
          if (video.videoWidth > 0 && ws.bufferedAmount < 1_500_000 && context) {
            last = time;
            busy = true;
            try {
              const longEdge = Math.max(video.videoWidth, video.videoHeight);
              // 640 on the long edge is enough for the face and chest, and keeps the
              // server's JPEG decode and the SDK inside a small CPU budget.
              const scale = Math.min(1, 640 / longEdge);
              const width = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
              const height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
              if (canvas.width !== width) canvas.width = width;
              if (canvas.height !== height) canvas.height = height;
              context.drawImage(video, 0, 0, width, height);
              const blob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', 0.86),
              );
              if (
                blob &&
                running.current &&
                ws.readyState === WebSocket.OPEN &&
                ws.bufferedAmount < 1_500_000
              ) {
                const jpeg = new Uint8Array(await blob.arrayBuffer());
                const packet = new Uint8Array(8 + jpeg.length);
                new DataView(packet.buffer).setFloat64(
                  0,
                  (performance.now() - origin) * 1000 + 1_000_000,
                  false,
                );
                packet.set(jpeg, 8);
                ws.send(packet);
              }
            } finally {
              busy = false;
            }
          }
        }
        if (running.current && !abort.signal.aborted) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    if (mode === 'sample') void runSample();
    else void runLive();

    return () => {
      running.current = false;
      abort.abort();
      stopCamera();
      wsRef.current?.close();
      window.clearInterval(timer);
    };
    // The check-in is tied to the URL. Restarting mid-sit would drop the camera.
  }, []);

  function sendJson(payload: unknown) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function pickMood(next: MoodId) {
    setMood(next);
    sendJson({ type: 'mood', mood: next });
  }

  function changeNote(value: string) {
    setNote(value);
    sendJson({ type: 'note', note: value });
  }

  function withdraw() {
    running.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (mode === 'sample') {
      setError('Sample ended. Nothing was saved.');
      setPhase('error');
      return;
    }
    sendJson({ type: 'withdraw' });
    if (consentId) {
      void api(`/api/consents/${consentId}/withdraw`, { method: 'POST' }).catch(() => undefined);
    }
  }

  function finish() {
    running.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (mode === 'sample') {
      setSaved(false);
      setPhase('result');
      return;
    }
    sendJson({ type: 'finish' });
    window.setTimeout(() => {
      if (phaseRef.current === 'run') setPhase('result');
    }, 8000);
  }

  const hint = visibleHint(signals, elapsed);
  const breathingLive = Boolean(signals.breathing && signals.breathing.confidence >= 45);
  const breathMs = breathingLive
    ? `${Math.round(60000 / (signals.breathing?.value || 14))}ms`
    : '4.3s';
  const traced = breathingLive && breathSpread !== null;

  if (phase === 'error') {
    return (
      <Shell title="Check-in stopped">
        <p className="kicker">Camera off</p>
        <h1>The check-in stopped</h1>
        <p className="lede">{error}</p>
        <button className="btn wide" type="button" onClick={onLeave}>
          Back to the house
        </button>
        <Disclaimer />
      </Shell>
    );
  }

  if (phase === 'result') {
    return (
      <Shell title="Check-in done">
        <p className="kicker">{mode === 'sample' ? 'Sample' : 'Kept'}</p>
        <h1>{mode === 'sample' ? 'That was a sample' : 'That’s the check-in'}</h1>
        {mode === 'sample' ? (
          <p className="lede">
            Nothing was written down. The camera stayed off. The numbers were made up, on purpose,
            so you could see the shape of a sit.
          </p>
        ) : (
          <p className="lede">
            {saved
              ? 'The camera is off. What was steady enough is kept with the day.'
              : 'The camera is off.'}
          </p>
        )}
        {verdict && (
          <article className={`card ${verdict.status}`}>
            <VerdictLabel status={verdict.status} headline={verdict.headline} />
            <p>{verdict.explanation}</p>
          </article>
        )}
        <SignalGrid signals={signals} />
        <CoverageLine coverage={signals.coverage} />
        {signals.hrv && (
          <p className="fine">
            Also observed, and not used for usual or different: RMSSD {whole(signals.hrv.rmssd)} ms
            {signals.hrv.sdnn !== null ? `, SDNN ${whole(signals.hrv.sdnn)} ms` : ''}. This is not a
            wellbeing score.
          </p>
        )}
        {mood && <p>Picture tapped: {moodLabel(mood)}.</p>}
        {note && <p className="note-quote">“{note}”</p>}
        <div className="stack">
          {mode === 'live' && (
            <button className="btn wide" type="button" onClick={onStory}>
              See the days
            </button>
          )}
          <button className="btn secondary wide" type="button" onClick={onLeave}>
            Back to the house
          </button>
        </div>
        <Disclaimer />
      </Shell>
    );
  }

  return (
    <Shell title={mode === 'sample' ? 'Sample check-in' : 'Check-in'}>
      <div className="topbar">
        <p className="kicker" style={{ margin: 0 }}>
          {name}
        </p>
        <p className="wordmark" style={{ fontSize: '1.6rem' }}>
          {clock(elapsed)}
        </p>
      </div>
      <h1 style={{ fontSize: '2rem' }}>How are you today?</h1>
      <div className="preview-wrap">
        <div
          className={`preview-frame${breathingLive ? ' paced' : ''}${traced ? ' traced' : ''}`}
          style={{
            ['--breath-ms' as string]: breathMs,
            boxShadow: traced ? `0 0 0 ${breathSpread}px rgba(20, 92, 56, 0.28)` : undefined,
          }}
        >
          {mode === 'live' ? (
            <video ref={videoRef} playsInline muted autoPlay aria-label="Live camera preview" />
          ) : (
            <div
              className="sample-stage"
              role="img"
              aria-label="Sample picture. The camera is off."
            />
          )}
          <span className={mode === 'live' ? 'live-ribbon' : 'sample-ribbon'}>
            {mode === 'live' ? 'Live Presage' : 'Sample'}
          </span>
        </div>
      </div>
      <p className="status-banner" role="status">
        {hint}
      </p>
      <SignalGrid signals={signals} />
      <CoverageLine coverage={signals.coverage} />
      {signals.expression && (
        <p className="fine">
          What the camera saw: {signals.expression.words}. A face is not a feeling. The picture you
          tap is the answer.
        </p>
      )}
      <div className="checkin-tail">
        <MoodBoard value={mood} onChange={pickMood} />
        <div style={{ marginTop: '0.8rem' }}>
          {noteOpen ? (
            <div className="field">
              <label htmlFor="note">A few words, if you want</label>
              <textarea
                id="note"
                value={note}
                maxLength={280}
                onChange={(event) => changeNote(event.target.value)}
                placeholder="Only what you type is kept."
              />
              <p className="fine">
                If speaking is easier, say it to the person with you and let them type. We do not
                record a voice.
              </p>
            </div>
          ) : (
            <button className="btn secondary wide" type="button" onClick={() => setNoteOpen(true)}>
              Add a few words
            </button>
          )}
        </div>
        {mode === 'live' && (
          <p>
            <button className="btn quiet" type="button" onClick={withdraw}>
              Withdraw agreement and stop
            </button>
          </p>
        )}
      </div>
      <div className="checkin-bar">
        <p className={`rec${mode === 'sample' ? ' off' : ''}`}>
          <i aria-hidden="true" />
          {mode === 'live' ? 'Camera is on' : 'Camera is off'}
        </p>
        <button className="btn clay" type="button" onClick={finish}>
          {mode === 'live' ? 'Stop' : 'End sample'}
        </button>
      </div>
    </Shell>
  );
}

function signalPhase(
  present: boolean,
  validSeconds: number | undefined,
  ageMs: number | null | undefined,
): 'warming' | 'live' | 'stale' | 'settling' {
  if (!present) return 'warming';
  if (ageMs != null && ageMs > 3000) return 'stale';
  if (validSeconds === 0) return 'settling';
  return 'live';
}

function SignalGrid({ signals }: { signals: Signals }) {
  const pulsePhase = signalPhase(
    Boolean(signals.pulse),
    signals.coverage?.pulse.validSeconds,
    signals.coverage?.pulse.ageMs,
  );
  const breathPhase = signalPhase(
    Boolean(signals.breathing),
    signals.coverage?.breathing.validSeconds,
    signals.coverage?.breathing.ageMs,
  );
  const hrvPhase = signalPhase(
    Boolean(signals.hrv),
    signals.coverage?.hrv.validSeconds,
    signals.coverage?.hrv.ageMs,
  );
  return (
    <div className="signals">
      <SignalTile
        name="Pulse"
        phase={pulsePhase}
        value={signals.pulse ? whole(signals.pulse.value) : '—'}
        unit={
          signals.pulse
            ? `beats / min · confidence ${Math.round(signals.pulse.confidence)}`
            : 'warm-up about 12 seconds'
        }
        state={
          pulsePhase === 'stale'
            ? `Last sample ${Math.round((signals.coverage?.pulse.ageMs ?? 0) / 1000)}s ago`
            : signals.pulse
              ? quality('pulse', signals.pulse.confidence)
              : 'No number yet'
        }
      />
      <SignalTile
        name="Breathing"
        phase={breathPhase}
        value={signals.breathing ? whole(signals.breathing.value) : '—'}
        unit={
          signals.breathing
            ? `breaths / min · confidence ${Math.round(signals.breathing.confidence)}`
            : 'warm-up about half a minute'
        }
        state={
          breathPhase === 'stale'
            ? `Last sample ${Math.round((signals.coverage?.breathing.ageMs ?? 0) / 1000)}s ago`
            : signals.breathing
              ? quality('breathing', signals.breathing.confidence)
              : 'No number yet'
        }
      />
      <SignalTile
        name="Beat to beat"
        phase={hrvPhase}
        value={signals.hrv ? whole(signals.hrv.rmssd) : '—'}
        unit={
          signals.hrv
            ? `RMSSD ms${signals.hrv.sdnn !== null ? ` · SDNN ${whole(signals.hrv.sdnn)}` : ''} · not a score`
            : 'warm-up about a minute'
        }
        state={signals.hrv ? quality('hrv', signals.hrv.confidence) : 'No number yet'}
        span
      />
    </div>
  );
}

function CoverageLine({ coverage }: { coverage?: Coverage | null }) {
  if (!coverage) return <p className="fine">Valid seconds appear once a signal is steady.</p>;
  return (
    <p className="fine">
      Valid seconds so far — pulse {coverage.pulse.validSeconds}, breathing{' '}
      {coverage.breathing.validSeconds}, beat-to-beat {coverage.hrv.validSeconds}. A second counts
      only when that signal’s confidence is high enough. Missing seconds stay missing.
    </p>
  );
}

function SignalTile({
  name,
  phase,
  value,
  unit,
  state,
  span,
}: {
  name: string;
  phase: 'warming' | 'live' | 'stale' | 'settling';
  value: string;
  unit: string;
  state: string;
  span?: boolean;
}) {
  const label =
    phase === 'warming'
      ? 'Warming up'
      : phase === 'stale'
        ? 'Stale'
        : phase === 'settling'
          ? 'Settling'
          : 'Live';
  return (
    <div className={`signal${span ? ' span' : ''}`}>
      <span className="name">
        {name} · {label}
      </span>
      <strong>{phase === 'warming' ? '—' : value}</strong>
      <span className="state">
        {unit}. {state}.
      </span>
    </div>
  );
}

function moodLabel(id: MoodId): string {
  if (id === 'sunny') return 'Good';
  if (id === 'steady') return 'Okay';
  if (id === 'tired') return 'Tired';
  if (id === 'uneasy') return 'Unsettled';
  return 'Stay close';
}
