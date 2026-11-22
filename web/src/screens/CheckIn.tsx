import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { type MoodId } from '../copy';
import { clock, whole } from '../format';
import type { HrvMeasure, Measure, Verdict } from '../types';
import { MoodArt, MoodBoard } from '../components/MoodBoard';
import { Orb } from '../components/Orb';
import { Disclaimer, Pebble, RangeBar, STATUS_TITLE, Shell } from '../components/ui';

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

const MINUTE = 60_000;
const HIDE_FACE_KEY = 'nudge.hideFace';

function initialHideFace(): boolean {
  const privacy = new URLSearchParams(location.search).get('privacy');
  if (privacy === '1') return true;
  if (privacy === '0') return false;
  try {
    const stored = localStorage.getItem(HIDE_FACE_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    // Private browsing can refuse storage. The preview stays hidden.
  }
  return true;
}

function guide(elapsedMs: number, talking: boolean): string {
  if (talking) return 'A little quieter, if you can.';
  if (elapsedMs < 8000) return 'Find your face in the circle.';
  if (elapsedMs < 18000) return 'Sit still. Listening for your pulse.';
  if (elapsedMs < 34000) return 'Breathe slowly, with the glow.';
  if (elapsedMs < MINUTE) return 'Tap the picture that fits today.';
  return 'That’s plenty. Tap Done when you’re ready.';
}

const ADVISORY_CODES = new Set([3, 7, 11, 12, 15]);

function visibleHint(signals: Signals, elapsedMs: number): string {
  const code = signals.validation.code;
  if (code === 11) return 'Hold still. A slightly slower camera is fine.';
  if (ADVISORY_CODES.has(code) && (signals.pulse || signals.breathing)) {
    return guide(elapsedMs, signals.talking);
  }
  if (code === 7) return 'See if your shoulders sit in the circle too, then hold still.';
  if (code === 15)
    return 'Tilt the phone a little so your face sits in the middle, then hold still.';
  if (code === 3) return 'Keep your face in the middle of the circle.';
  if (code === 12) return 'Hold a little stiller, if you can.';
  if (code !== 0 && signals.validation.hint.trim()) return signals.validation.hint.trim();
  if (!signals.pulse && elapsedMs > 8000) {
    return 'Come a little closer, with light on your face, and hold still.';
  }
  return guide(elapsedMs, signals.talking);
}

function sampleSignals(elapsedMs: number): Signals {
  const wobble = Math.sin(elapsedMs / 900);
  return {
    pulse:
      elapsedMs >= 8000
        ? { value: Math.round((72 + wobble * 1.2) * 10) / 10, confidence: 64, stable: true }
        : null,
    breathing: elapsedMs >= 16000 ? { value: 14, confidence: 58, stable: true } : null,
    hrv:
      elapsedMs >= 60000
        ? { rmssd: 34, sdnn: 42, meanNn: 830, confidence: 55, stable: true }
        : null,
    expression: elapsedMs > 8000 ? { words: 'a quiet face', confidence: 50 } : null,
    talking: false,
    pulseTrace: elapsedMs >= 8000 ? Math.sin(elapsedMs / 140) : null,
    breathTrace: elapsedMs >= 16000 ? Math.sin((elapsedMs / 4300) * Math.PI * 2) : null,
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
  const pulseValid = steadySeconds(elapsedMs, 8_000);
  const breathValid = steadySeconds(elapsedMs, 16_000);
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
  const [resultPulse, setResultPulse] = useState<number | null>(null);
  const [resultBreathing, setResultBreathing] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);
  const [, setSaved] = useState(false);
  const [hideFace, setHideFace] = useState(initialHideFace);
  const [breath, setBreath] = useState<number | null>(null);
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
        await new Promise((resolve) => setTimeout(resolve, 120));
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
      setBreath(amount);
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
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
          },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'user', frameRate: { ideal: 30 } },
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
          const pulse = body.pulse as { value?: number } | null;
          const breathing = body.breathing as { value?: number } | null;
          setResultPulse(typeof pulse?.value === 'number' ? pulse.value : null);
          setResultBreathing(typeof breathing?.value === 'number' ? breathing.value : null);
          setSettled(true);
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

      const video = videoRef.current;
      if (!video) return;
      let encoding = false;
      let frameHandle = 0;
      let lastSent = 0;
      const paced = typeof video.requestVideoFrameCallback !== 'function';
      const stopLoop = () => {
        if (typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(frameHandle);
        } else {
          cancelAnimationFrame(frameHandle);
        }
      };
      abort.signal.addEventListener('abort', stopLoop);
      const schedule = () => {
        if (!running.current || abort.signal.aborted) return;
        if (typeof video.requestVideoFrameCallback === 'function') {
          frameHandle = video.requestVideoFrameCallback(() => {
            void capture();
          });
        } else {
          frameHandle = requestAnimationFrame(() => {
            void capture();
          });
        }
      };
      const capture = async () => {
        if (!running.current || abort.signal.aborted) return;
        const now = performance.now();
        if (
          encoding ||
          video.videoWidth <= 0 ||
          ws.readyState !== WebSocket.OPEN ||
          ws.bufferedAmount >= 250_000 ||
          (paced && now - lastSent < 1000 / 30)
        ) {
          schedule();
          return;
        }
        encoding = true;
        lastSent = now;
        try {
          const blob = await encodeJpeg(video);
          if (
            blob &&
            running.current &&
            ws.readyState === WebSocket.OPEN &&
            ws.bufferedAmount < 250_000
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
          encoding = false;
          schedule();
        }
      };
      schedule();
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
  const pulseSteady = Boolean(signals.pulse && signals.pulse.confidence >= 40);
  const breathSteady = Boolean(signals.breathing && signals.breathing.confidence >= 45);
  const sample = mode === 'sample';

  if (phase === 'error') {
    return (
      <Shell title="Check-in stopped">
        <div className="done-hero">
          <Pebble status="quiet" size={88} />
          <p className="kicker">Camera off</p>
          <h1>The check-in stopped</h1>
          <p className="lede">{error}</p>
        </div>
        <button className="btn wide" type="button" onClick={onLeave}>
          Back to the house
        </button>
        <Disclaimer />
      </Shell>
    );
  }

  if (phase === 'result') {
    const thisPulse = settled ? resultPulse : sample ? null : (signals.pulse?.value ?? null);
    const thisBreathing = settled
      ? resultBreathing
      : sample
        ? null
        : (signals.breathing?.value ?? null);
    const thin = !sample && thisPulse === null && thisBreathing === null;
    const verdictMatches =
      verdict !== null &&
      verdict.pulseValue === thisPulse &&
      verdict.breathingValue === thisBreathing;
    const status = sample ? 'sample' : thin ? 'quiet' : verdictMatches ? verdict.status : 'quiet';
    return (
      <Shell title="Check-in done">
        <div className="done-hero">
          <Pebble status={status} size={132}>
            {mood && <MoodArt id={mood} className="pebble-art" />}
          </Pebble>
          <p className="kicker">
            {sample
              ? 'Sample · nothing saved'
              : thin && !mood && !note
                ? 'Camera off'
                : 'Saved · camera off'}
          </p>
          <h1>{sample ? 'That was a sample' : `Thank you, ${name}`}</h1>
          <p className="lede">{resultLine(status, name, sample, thin, Boolean(mood || note))}</p>
        </div>
        {!sample && !thin && (
          <section className="card">
            <h2 className="card-title">{verdictMatches ? STATUS_TITLE[status] : 'This sitting'}</h2>
            <RangeBar
              label="Pulse"
              unit="/min"
              value={thisPulse}
              band={verdictMatches && verdict ? verdict.pulseBand : null}
            />
            <RangeBar
              label="Breathing"
              unit="/min"
              value={thisBreathing}
              band={verdictMatches && verdict ? verdict.breathingBand : null}
            />
          </section>
        )}
        {sample && (
          <div className="readouts day">
            <Readout label="Pulse" value={signals.pulse ? whole(signals.pulse.value) : null} />
            <Readout
              label="Breathing"
              value={signals.breathing ? whole(signals.breathing.value) : null}
            />
          </div>
        )}
        {note && <p className="note-quote">“{note}”</p>}
        <details className="card fold">
          <summary>Measurement details</summary>
          {thin ? (
            <p>
              {mood || note
                ? 'Not enough steady seconds this time. Your picture and note are kept.'
                : 'Not enough steady seconds this time. Nothing from this sitting was kept.'}
            </p>
          ) : (
            verdictMatches && verdict?.explanation && <p>{verdict.explanation}</p>
          )}
          <CoverageLine coverage={signals.coverage} />
          {signals.hrv && (
            <p className="fine">
              Beat-to-beat (not used for usual or different): RMSSD {whole(signals.hrv.rmssd)} ms
              {signals.hrv.sdnn !== null ? `, SDNN ${whole(signals.hrv.sdnn)} ms` : ''}.
            </p>
          )}
        </details>
        <div className="stack">
          {!sample && (
            <button className="btn wide" type="button" onClick={onStory}>
              See {name}’s days
            </button>
          )}
          <button
            className={`btn wide${sample ? '' : ' secondary'}`}
            type="button"
            onClick={onLeave}
          >
            Back to the house
          </button>
        </div>
        <Disclaimer />
      </Shell>
    );
  }

  return (
    <Shell title={sample ? 'Sample check-in' : 'Check-in'} tone="night" flush>
      <div className="checkin-top">
        <span className={`badge${sample ? ' sample' : ' live'}`}>
          {sample ? 'Sample · made-up numbers' : 'Live · Presage'}
        </span>
        <span className="clock" aria-label="Time so far">
          {clock(elapsed)}
        </span>
      </div>
      <Orb
        mode={mode}
        videoRef={videoRef}
        breath={breathSteady ? breath : null}
        breathRate={breathSteady ? (signals.breathing?.value ?? null) : null}
        pulseRate={pulseSteady ? (signals.pulse?.value ?? null) : null}
        progress={elapsed / MINUTE}
        hideFace={hideFace}
      />
      <button
        type="button"
        className={`face-toggle${hideFace ? ' on' : ''}`}
        aria-pressed={hideFace}
        onClick={() => {
          setHideFace((current) => {
            const next = !current;
            try {
              localStorage.setItem(HIDE_FACE_KEY, next ? '1' : '0');
            } catch {
              // The choice still applies for this sitting.
            }
            return next;
          });
        }}
      >
        <span className="face-toggle-knob" aria-hidden="true" />
        Hide my face
      </button>
      <p className="hint" role="status" aria-live="polite">
        {hint}
      </p>
      <div className="readouts">
        <Readout
          label="Pulse"
          value={signals.pulse ? whole(signals.pulse.value) : null}
          waiting="finding"
        />
        <Readout
          label="Breathing"
          value={signals.breathing ? whole(signals.breathing.value) : null}
          waiting="finding"
        />
      </div>
      <section className="checkin-tail" aria-labelledby="ask">
        <h1 id="ask" className="ask">
          How are you today{name && name !== 'Check-in' ? `, ${name}` : ''}?
        </h1>
        <MoodBoard value={mood} onChange={pickMood} />
        <div className="note-area">
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
            </div>
          ) : (
            <button className="btn ghost wide" type="button" onClick={() => setNoteOpen(true)}>
              Add a few words
            </button>
          )}
        </div>
        {!sample && (
          <button className="btn quiet" type="button" onClick={withdraw}>
            Stop and withdraw agreement
          </button>
        )}
      </section>
      <div className="checkin-bar">
        <p className={`rec${sample ? ' off' : ''}`}>
          <i aria-hidden="true" />
          {sample ? 'Camera off' : 'Camera on'}
        </p>
        <button className="btn apricot" type="button" onClick={finish}>
          {mood ? 'Done' : sample ? 'End sample' : 'Stop'}
        </button>
      </div>
    </Shell>
  );
}

function resultLine(
  status: string,
  name: string,
  sample: boolean,
  thin: boolean,
  keptWords: boolean,
): string {
  if (sample)
    return 'The camera stayed off and nothing was written down. The numbers were made up so you can see how a check-in feels.';
  if (thin) {
    return keptWords
      ? 'Not enough steady seconds this time. Your picture and note are kept.'
      : 'Not enough steady seconds this time. Nothing from this sitting was kept.';
  }
  if (status === 'usual') return `Pulse and breathing sat inside ${name}’s own usual range.`;
  if (status === 'different')
    return `Something sat outside ${name}’s own usual range today. It is one day. Read it alongside what you know about them.`;
  if (status === 'learning') return 'Written down. After five steady days we can start comparing.';
  return 'Not enough steady seconds to compare this time. That is fine. The picture still counts.';
}

const JPEG_QUALITY = 0.5;
const JPEG_LONG_EDGE = 320;

// CSS filters on the preview (the face hide) do not affect capture.
// createImageBitmap and drawImage read the video element, so the SDK still gets clear frames.
let jpegCanvas: OffscreenCanvas | null = null;
let jpegFallback: HTMLCanvasElement | null = null;

async function encodeJpeg(video: HTMLVideoElement): Promise<Blob | null> {
  const longEdge = Math.max(video.videoWidth, video.videoHeight);
  const scale = Math.min(1, JPEG_LONG_EDGE / longEdge);
  const width = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
  try {
    const bitmap = await createImageBitmap(video, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'low',
    });
    try {
      if (!jpegCanvas || jpegCanvas.width !== width || jpegCanvas.height !== height) {
        jpegCanvas = new OffscreenCanvas(width, height);
      }
      const context = jpegCanvas.getContext('2d', { alpha: false });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, width, height);
      return await jpegCanvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    } finally {
      bitmap.close();
    }
  } catch {
    if (!jpegFallback) jpegFallback = document.createElement('canvas');
    if (jpegFallback.width !== width) jpegFallback.width = width;
    if (jpegFallback.height !== height) jpegFallback.height = height;
    const context = jpegFallback.getContext('2d', { alpha: false });
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return await new Promise((resolve) =>
      jpegFallback?.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
  }
}

function Readout({
  label,
  value,
  waiting = 'waiting',
}: {
  label: string;
  value: string | null;
  waiting?: string;
}) {
  return (
    <div className={`readout${value ? ' on' : ''}`}>
      <span className="readout-label">{label}</span>
      {value ? (
        <strong>
          {value}
          <small>/min</small>
        </strong>
      ) : (
        <span className="readout-wait">
          {waiting}
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

function CoverageLine({ coverage }: { coverage?: Coverage | null }) {
  if (!coverage) return <p className="fine">Valid seconds appear once a signal is steady.</p>;
  return (
    <p className="fine">
      Steady seconds: pulse {coverage.pulse.validSeconds}, breathing{' '}
      {coverage.breathing.validSeconds}, beat-to-beat {coverage.hrv.validSeconds}.
    </p>
  );
}
