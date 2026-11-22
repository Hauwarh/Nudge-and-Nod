import { useEffect, type ReactNode } from 'react';
import { NOT_A_MEDICAL_DEVICE, SHORT_DISCLAIMER, WHAT_THIS_IS_NOT } from '../copy';
import type { Band, VerdictStatus } from '../types';
import { whole } from '../format';

export function Shell({
  title,
  tone = 'day',
  children,
}: {
  title?: string;
  tone?: 'day' | 'night';
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = title ? `${title} · Nudge & Nod` : 'Nudge & Nod';
    document.body.dataset.tone = tone;
    return () => {
      delete document.body.dataset.tone;
    };
  }, [title, tone]);
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <main id="content" className="page">
        {children}
      </main>
    </>
  );
}

export function Wordmark() {
  return (
    <p className="wordmark">
      <Mark />
      <span>
        Nudge <em>&amp;</em> Nod
      </span>
    </p>
  );
}

/** Two pebbles leaning on each other. The small one nods on hover and on the welcome screen. */
export function Mark({ size = 34, nodding = false }: { size?: number; nodding?: boolean }) {
  return (
    <svg
      className={`mark${nodding ? ' nodding' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path d="M8 42c0-11 8-19 19-19s20 8 20 18c0 9-8 15-20 15S8 51 8 42z" fill="var(--moss)" />
      <g className="nodder">
        <path
          d="M33 22c0-8 6-14 14-14s13 6 13 13c0 7-6 12-14 12s-13-4-13-11z"
          fill="var(--apricot)"
        />
      </g>
    </svg>
  );
}

export function Disclaimer({ full = false }: { full?: boolean; text?: string }) {
  return <p className="disclaimer">{full ? NOT_A_MEDICAL_DEVICE : SHORT_DISCLAIMER}</p>;
}

export function WhatThisIsNot() {
  return (
    <details className="card fold">
      <summary>What this is not</summary>
      <p>{WHAT_THIS_IS_NOT}</p>
    </details>
  );
}

const STATUS_WORD: Record<VerdictStatus, string> = {
  usual: 'usual day',
  different: 'different from usual',
  learning: 'still learning',
  quiet: 'no steady numbers',
  sample: 'sample',
};

export function statusWord(status: VerdictStatus): string {
  return STATUS_WORD[status];
}

export const STATUS_TITLE: Record<VerdictStatus, string> = {
  usual: 'A usual day',
  different: 'Different from usual',
  learning: 'Learning their usual',
  quiet: 'Not enough steady seconds',
  sample: 'Sample',
};

export function VerdictLabel({ status, headline }: { status: VerdictStatus; headline: string }) {
  return (
    <p className="verdict-label">
      <Pebble status={status} size={18} />
      <span>{headline}</span>
    </p>
  );
}

/** One day as a pebble. Shape varies a little per seed so a row of them looks hand-placed. */
export function Pebble({
  status,
  size = 40,
  seed = 0,
  children,
}: {
  status: VerdictStatus | 'empty';
  size?: number;
  seed?: number;
  children?: ReactNode;
}) {
  const shapes = [
    '48% 52% 46% 54% / 55% 45% 55% 45%',
    '55% 45% 52% 48% / 48% 56% 44% 52%',
    '44% 56% 50% 50% / 52% 48% 52% 48%',
    '52% 48% 58% 42% / 46% 54% 46% 54%',
  ];
  return (
    <span
      className={`pebble ${status}`}
      style={{ width: size, height: size * 0.88, borderRadius: shapes[seed % shapes.length] }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/**
 * Where today's number sits against their own spread. The darker middle is the middle half of
 * their earlier days. Past the pale ends is where we say "different".
 */
export function RangeBar({
  label,
  unit,
  value,
  band,
}: {
  label: string;
  unit: string;
  value: number | null;
  band: Band | null;
}) {
  if (value === null) return null;
  if (!band) {
    return (
      <div className="range">
        <div className="range-head">
          <span>{label}</span>
          <strong>
            {whole(value)} <small>{unit}</small>
          </strong>
        </div>
        <p className="fine">Written down. Not enough earlier days to compare yet.</p>
      </div>
    );
  }
  const pad = Math.max(3, (band.high - band.low) * 0.35);
  const min = Math.min(band.low - pad, value - 2);
  const max = Math.max(band.high + pad, value + 2);
  const at = (n: number) => `${((n - min) / (max - min)) * 100}%`;
  const outside = value < band.low || value > band.high;
  return (
    <div className="range">
      <div className="range-head">
        <span>{label}</span>
        <strong className={outside ? 'off' : undefined}>
          {whole(value)} <small>{unit}</small>
        </strong>
      </div>
      <div
        className="range-track"
        role="img"
        aria-label={`${label} ${whole(value)}. Their usual middle is ${whole(band.q1)} to ${whole(band.q3)}. Different means outside ${whole(band.low)} to ${whole(band.high)}.`}
      >
        <span
          className="range-ok"
          style={{ left: at(band.low), right: `calc(100% - ${at(band.high)})` }}
        />
        <span
          className="range-mid"
          style={{ left: at(band.q1), right: `calc(100% - ${at(band.q3)})` }}
        />
        <span className={`range-dot${outside ? ' off' : ''}`} style={{ left: at(value) }} />
      </div>
      <div className="range-scale" aria-hidden="true">
        <span style={{ left: at(band.low) }}>{whole(band.low)}</span>
        <span style={{ left: at(band.high) }}>{whole(band.high)}</span>
      </div>
    </div>
  );
}
