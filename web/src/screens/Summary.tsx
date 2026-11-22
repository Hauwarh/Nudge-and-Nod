import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { dayLabel, whole } from '../format';
import type { Summary } from '../types';
import { Shell, Wordmark } from '../components/ui';
import { PebbleStrip } from '../components/PebbleStrip';

export function SummaryScreen({ memberId, onBack }: { memberId: string; onBack: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    api<Summary>(`/api/people/${memberId}/summary`)
      .then((next) => {
        if (!cancel) setSummary(next);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : 'The summary did not load.');
      });
    return () => {
      cancel = true;
    };
  }, [memberId]);

  async function share() {
    if (!summary) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `What we observed · ${summary.memberName}`,
          text: summary.plainText,
        });
        return;
      }
    } catch {
      // The share sheet was dismissed, or it failed. Fall through to the clipboard.
    }
    try {
      await navigator.clipboard.writeText(summary.plainText);
      setShareNote('Copied. You can paste it into a message.');
    } catch {
      setShareNote('Copy did not work on this browser. You can still print or save as PDF.');
    }
  }

  const from = summary?.from ? dayLabel(summary.from) : null;
  const to = summary?.to ? dayLabel(summary.to) : null;

  return (
    <Shell title="What we observed">
      <div className="topbar noprint">
        <Wordmark />
        <button className="linkish" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      {!summary && !error && <p>Preparing the page…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {summary && (
        <article className="sheet">
          <p className="kicker">What we observed</p>
          <h1>{summary.memberName}</h1>
          <p>
            {summary.householdName}
            {from && to ? ` · ${from} to ${to}` : ''}
          </p>
          {summary.days.length > 0 && (
            <div className="strip-scroll">
              <PebbleStrip days={summary.days} size={34} />
            </div>
          )}
          <p className="narrative">{summary.narrative}</p>
          {summary.days.length > 0 && (
            <>
              <h2>The numbers</h2>
              <table className="numbers">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Picture</th>
                    <th>Pulse</th>
                    <th>Breathing</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.days.map((day) => (
                    <tr key={day.id}>
                      <td>{dayLabel(day.at)}</td>
                      <td>{day.moodLabel ?? '—'}</td>
                      <td>{day.pulse !== null ? whole(day.pulse) : '—'}</td>
                      <td>{day.breathing !== null ? whole(day.breathing) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="stack noprint" style={{ marginTop: '1rem' }}>
            <button className="btn wide" type="button" onClick={() => window.print()}>
              Print or save as PDF
            </button>
            <button className="btn secondary wide" type="button" onClick={() => void share()}>
              Share the words
            </button>
            {shareNote && <p>{shareNote}</p>}
          </div>
        </article>
      )}
    </Shell>
  );
}
