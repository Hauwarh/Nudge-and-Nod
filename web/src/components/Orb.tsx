import type { CSSProperties, RefObject } from 'react';

/**
 * The check-in's centre. The camera sits inside a circle. Around it:
 * - a glow that grows and shrinks with the person's own breathing trace from Presage
 *   (or a slow default rhythm until breathing is steady),
 * - a ripple that leaves the circle once per heartbeat, at the live pulse rate,
 * - a thin ring that fills over the minute.
 */
export function Orb({
  mode,
  videoRef,
  breath,
  breathRate,
  pulseRate,
  progress,
  hideFace = false,
}: {
  mode: 'live' | 'sample';
  videoRef: RefObject<HTMLVideoElement>;
  /** 0 = fully out, 1 = fully in. Null until breathing is steady. */
  breath: number | null;
  breathRate: number | null;
  pulseRate: number | null;
  progress: number;
  /** Blur the on-screen preview only. Capture still reads the raw video. */
  hideFace?: boolean;
}) {
  const r = 47;
  const circumference = 2 * Math.PI * r;
  const style = {
    '--breath': breath ?? 0.5,
    '--breath-ms': `${Math.round(60000 / (breathRate || 7.5))}ms`,
    '--beat-ms': pulseRate ? `${Math.round(60000 / pulseRate)}ms` : '0ms',
  } as CSSProperties;
  return (
    <div
      className={`orb${breath !== null ? ' traced' : ' resting'}${pulseRate ? ' beating' : ''}`}
      style={style}
    >
      <span className="orb-glow" aria-hidden="true" />
      <span className="orb-beat" aria-hidden="true" />
      <svg className="orb-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, progress))}
        />
      </svg>
      <div className={`orb-window${hideFace ? ' face-hidden' : ''}`}>
        {mode === 'live' ? (
          <video
            ref={videoRef}
            className={hideFace ? 'face-hidden' : undefined}
            playsInline
            muted
            autoPlay
            aria-label="Live camera preview"
          />
        ) : (
          <div className="sample-stage" role="img" aria-label="Sample. The camera is off.">
            <span />
          </div>
        )}
        {hideFace && mode === 'live' && (
          <>
            <span className="face-wash" aria-hidden="true" />
            <span className="face-hidden-label">Face hidden on screen</span>
          </>
        )}
      </div>
    </div>
  );
}
