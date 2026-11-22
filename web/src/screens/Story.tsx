import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { MOOD_BY_LABEL } from '../copy';
import { dayLabel, whole } from '../format';
import type { Story, StoryDay } from '../types';
import { DayChart } from '../components/DayChart';
import { MoodArt } from '../components/MoodBoard';
import { PebbleStrip } from '../components/PebbleStrip';
import { Disclaimer, Pebble, RangeBar, STATUS_TITLE, Shell, statusWord } from '../components/ui';

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
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [story]);

  useEffect(() => {
    let cancel = false;
    api<Story>(`/api/people/${memberId}/story`)
      .then((next) => {
        if (cancel) return;
        setStory(next);
        setSelected(next.days[next.days.length - 1]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : 'The days did not load.');
      });
    return () => {
      cancel = true;
    };
  }, [memberId]);

  const day = story?.days.find((item) => item.id === selected) ?? null;
  const latest = story?.latest ?? null;

  return (
    <Shell title={story ? `${story.name}’s days` : 'Days'}>
      <div className="topbar">
        <button className="linkish back" type="button" onClick={onBack}>
          ‹ House
        </button>
      </div>
      {!story && !error && <p className="loading">Reading the days…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {story && (
        <>
          <header className="story-head">
            <span className="avatar big" aria-hidden="true">
              {story.name.charAt(0)}
            </span>
            <div>
              <h1>{story.name}</h1>
              {latest ? (
                <p className="story-status">
                  <Pebble status={latest.verdict.status} size={18} />
                  {STATUS_TITLE[latest.verdict.status]}
                  <span className="fine"> · {dayLabel(latest.at).toLowerCase()}</span>
                </p>
              ) : (
                <p className="fine">No check-ins yet.</p>
              )}
            </div>
          </header>

          {story.days.length > 0 ? (
            <>
              <h2 className="section">Their days</h2>
              <div className="strip-scroll" ref={scroller}>
                <PebbleStrip
                  days={story.days.slice(-14)}
                  selected={selected}
                  onSelect={setSelected}
                  label="Tap a day"
                />
              </div>
              <Legend />
              {day && (
                <DayCard
                  day={day}
                  story={story}
                  isLatest={day.id === story.days[story.days.length - 1]?.id}
                />
              )}
            </>
          ) : (
            <section className="empty">
              <Pebble status="empty" size={96} />
              <p className="lede">
                The first check-in starts their record. After five steady days we can say whether a
                new day looks like their usual.
              </p>
            </section>
          )}

          {story.days.length >= 2 && (
            <details className="card fold">
              <summary>Pulse over time</summary>
              <DayChart days={story.days} band={latest?.verdict.pulseBand ?? null} />
            </details>
          )}
          <details className="card fold">
            <summary>How “usual” is decided</summary>
            <p>
              We compare {story.name} only with {story.name}. A number counts when the measurement
              was steady for at least 8 seconds. After 5 earlier days, the middle half of those days
              becomes their usual. We only say “different” when a number falls well outside it.
              Beat-to-beat and face readings are not part of this, and nothing here is a score.
            </p>
          </details>

          <div className="stack">
            <button className="btn moss wide" type="button" onClick={onCheckIn}>
              Check in with {story.name}
            </button>
            <button className="btn secondary wide" type="button" onClick={onSummary}>
              One-page summary for a professional
            </button>
          </div>
          <Disclaimer />
        </>
      )}
    </Shell>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="What the pebbles mean">
      <li>
        <Pebble status="usual" size={14} /> usual
      </li>
      <li>
        <Pebble status="different" size={14} /> different
      </li>
      <li>
        <Pebble status="learning" size={14} /> still learning
      </li>
    </ul>
  );
}

function DayCard({ day, story, isLatest }: { day: StoryDay; story: Story; isLatest: boolean }) {
  const mood = day.moodLabel ? MOOD_BY_LABEL[day.moodLabel] : undefined;
  const verdict = isLatest ? story.latest?.verdict : null;
  return (
    <article className={`day-card ${day.status}`} aria-live="polite">
      <div className="day-card-head">
        {mood ? (
          <span className={`day-mood mood-${mood}`}>
            <MoodArt id={mood} className="day-mood-art" />
          </span>
        ) : null}
        <div>
          <p className="fine">{dayLabel(day.at)}</p>
          <h3>{day.moodLabel ?? 'No picture tapped'}</h3>
          <p className={`chip ${day.status}`}>{statusWord(day.status)}</p>
        </div>
      </div>
      {day.note && <p className="note-quote">“{day.note}”</p>}
      {verdict ? (
        <>
          <RangeBar label="Pulse" unit="/min" value={verdict.pulseValue} band={verdict.pulseBand} />
          <RangeBar
            label="Breathing"
            unit="/min"
            value={verdict.breathingValue}
            band={verdict.breathingBand}
          />
        </>
      ) : (
        <p className="day-numbers">
          {day.pulse !== null && (
            <span>
              <small>Pulse</small> {whole(day.pulse)}
            </span>
          )}
          {day.breathing !== null && (
            <span>
              <small>Breathing</small> {whole(day.breathing)}
            </span>
          )}
        </p>
      )}
      <details className="fold-inline">
        <summary>Measurement details</summary>
        <p className="fine">
          {day.pulseValidSeconds !== null
            ? `${day.pulseValidSeconds}s steady pulse`
            : 'Pulse seconds unknown'}
          {day.breathingValidSeconds !== null
            ? ` · ${day.breathingValidSeconds}s steady breathing`
            : ''}
          {day.endedReason === 'withdrawn' ? ' · agreement withdrawn' : ''}
          {day.hrvRmssd !== null ? ` · beat-to-beat RMSSD ${Math.round(day.hrvRmssd)} ms` : ''}
          {day.expressionWords ? ` · camera saw ${day.expressionWords}` : ''}.
        </p>
      </details>
    </article>
  );
}
