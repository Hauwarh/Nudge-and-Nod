import { useEffect, type ReactNode } from 'react';
import { NOT_A_MEDICAL_DEVICE, WHAT_THIS_IS_NOT } from '../copy';
import type { VerdictStatus } from '../types';

export function Shell({ title, children }: { title?: string; children: ReactNode }) {
  useEffect(() => {
    document.title = title ? `${title} · Nudge & Nod` : 'Nudge & Nod';
  }, [title]);
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
        Nudge <em>&</em> Nod
      </span>
    </p>
  );
}

export function Mark() {
  return (
    <svg width="36" height="36" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="26" cy="36" r="14" fill="#145C38" />
      <circle cx="42" cy="28" r="11" fill="#8E3018" />
    </svg>
  );
}

export function Disclaimer({ text = NOT_A_MEDICAL_DEVICE }: { text?: string }) {
  return <p className="disclaimer">{text}</p>;
}

export function WhatThisIsNot() {
  return (
    <section className="card">
      <h2>What this is not</h2>
      <p>{WHAT_THIS_IS_NOT}</p>
    </section>
  );
}

export function VerdictLabel({ status, headline }: { status: VerdictStatus; headline: string }) {
  return (
    <p className={`verdict-label`}>
      <i className={`dot ${status}`} aria-hidden="true" />
      <span>{headline}</span>
    </p>
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
