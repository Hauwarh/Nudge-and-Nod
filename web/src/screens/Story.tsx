import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { dayLabel, whole } from '../format';
import type { Story, StoryDay } from '../types';
import { DayChart } from '../components/DayChart';
import { Disclaimer, Shell, VerdictLabel, Wordmark } from '../components/ui';

export function StoryScreen({
  memberId,
  onBack,
  onSummary,
  onCheckIn,
}: {
  memberId: string;
  onBack: () => void;
  onSummary: () => void;
  onCheckIn: () => void;
}) {
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  useEffect(() => {
    let cancel = false;
    setShowEarlier(false);
    api<Story>(`/api/people/${memberId}/story`)
      .then((next) => {
        if (!cancel) setStory(next);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : 'The days did not load.');
      });
    return () => {
      cancel = true;
    };
  }, [memberId]);

  return (
    <Shell title={story ? `${story.name}’s days` : 'Days'}>
      <div className="topbar">
        <Wordmark />
        <button className="linkish" type="button" onClick={onBack}>
          House
        </button>
      </div>
      {!story && !error && <p>Reading the days…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {story && (
        <>
          <p className="kicker">Their own days</p>
          <h1>{story.name}</h1>
          {story.latest ? (
            <article className={`card ${story.latest.verdict.status}`}>
              <p className="fine">{dayLabel(story.latest.at)}</p>
              <VerdictLabel
                status={story.latest.verdict.status}
                headline={story.latest.verdict.headline}
              />
              <p>{story.latest.verdict.explanation}</p>
            </article>
          ) : (
            <p className="lede">
              No check-ins yet. After five steady ones, this page can say whether a new day looks
              like their usual.
            </p>
          )}
          <DayChart days={story.days} band={story.latest?.verdict.pulseBand ?? null} />
          <h2>The record</h2>
          {story.days.length === 0 ? (
            <p>Nothing written down yet.</p>
          ) : (
            <DayList
              days={[...story.days].reverse()}
              showEarlier={showEarlier}
              onToggle={() => setShowEarlier((open) => !open)}
            />
          )}
          <details className="method">
            <summary>How “usual” is decided</summary>
            <p>
              A pulse or breathing number counts only when its confidence meets the library’s steady
              mark (40 for pulse, 45 for breathing), it sits in the range that method can read, and
              the check-in had at least 8 separate seconds at that mark. We then need 5 earlier days
              — one reading a day, by the UTC date — before we say usual or different. Until then
              the line is “still learning their usual”. HRV and face descriptions are shown when we
              have them. They are not part of that comparison, and nothing here is a wellbeing
              score. Missing seconds are not filled in.
            </p>
          </details>
          <div className="stack">
            <button className="btn wide" type="button" onClick={onSummary}>
              One-page summary
            </button>
            <button className="btn secondary wide" type="button" onClick={onCheckIn}>
              Start a check-in
            </button>
          </div>
          <Disclaimer text={story.disclaimer} />
        </>
      )}
    </Shell>
  );
}

const RECENT_DAYS = 4;

function allSignalsSentence(day: StoryDay): string | null {
  const parts: string[] = [];
  if (day.hrvRmssd !== null) parts.push(`RMSSD ${Math.round(day.hrvRmssd)} ms`);
  if (day.hrvSdnn !== null) parts.push(`SDNN ${Math.round(day.hrvSdnn)} ms`);
  if (day.expressionWords) parts.push(`the camera saw ${day.expressionWords}`);
  if (parts.length === 0) return null;
  return `All signals, not used for usual or different: ${parts.join(', ')}. Not a wellbeing score.`;
}

function DayList({
  days,
  showEarlier,
  onToggle,
}: {
  days: StoryDay[];
  showEarlier: boolean;
  onToggle: () => void;
}) {
  const visible = showEarlier ? days : days.slice(0, RECENT_DAYS);
  const hidden = days.length - visible.length;
  return (
    <>
      <ol className="timeline">
        {visible.map((day) => {
          const signals = allSignalsSentence(day);
          return (
            <li key={day.id} className={day.status === 'different' ? 'different' : undefined}>
              <p className="day-date">{dayLabel(day.at)}</p>
              <div>
                <p style={{ margin: 0 }}>
                  <strong>{day.moodLabel ?? 'No picture'}</strong>
                  {day.pulse !== null ? ` · pulse ${whole(day.pulse)}` : ''}
                  {day.breathing !== null ? ` · breathing ${whole(day.breathing)}` : ''}
                </p>
                <p className="fine" style={{ margin: '0.15rem 0 0' }}>
                  {day.pulseValidSeconds !== null
                    ? `${day.pulseValidSeconds}s steady pulse`
                    : 'pulse seconds unknown'}
                  {day.breathingValidSeconds !== null
                    ? ` · ${day.breathingValidSeconds}s steady breathing`
                    : ''}
                  {day.pulseSamples !== null ? ` · ${day.pulseSamples} pulse samples` : ''}
                  {day.endedReason === 'withdrawn' ? ' · agreement withdrawn' : ''}
                </p>
                {signals && (
                  <p className="fine" style={{ margin: '0.15rem 0 0' }}>
                    {signals}
                  </p>
                )}
                <p className="fine" style={{ margin: '0.15rem 0 0' }}>
                  {day.status === 'different'
                    ? 'Different from the days before it'
                    : day.status === 'usual'
                      ? 'Inside their own spread'
                      : day.status === 'learning'
                        ? 'Written down, not compared yet'
                        : 'No steady stretch'}
                </p>
                {day.note && <p className="note-quote">“{day.note}”</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {days.length > RECENT_DAYS && (
        <button className="btn secondary" type="button" onClick={onToggle}>
          {showEarlier ? 'Show the latest days' : `Show earlier days (${hidden})`}
        </button>
      )}
    </>
  );
}
