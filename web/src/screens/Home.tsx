import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { dayLabel } from '../format';
import type { Me, Story } from '../types';
import { PebbleStrip } from '../components/PebbleStrip';
import { Disclaimer, Pebble, STATUS_TITLE, Shell, Wordmark } from '../components/ui';

export function Home({
  me,
  onCheckIn,
  onStory,
  onSettings,
}: {
  me: Me;
  onCheckIn: (memberId: string) => void;
  onStory: (memberId: string) => void;
  onSettings: () => void;
}) {
  const people = me.members.filter((member) => member.role === 'person');
  const [stories, setStories] = useState<Story[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setStories(null);
    Promise.all(people.map((person) => api<Story>(`/api/people/${person.id}/story`)))
      .then((rows) => {
        if (!cancel) setStories(rows);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof ApiError ? err.message : 'The days did not load.');
      });
    return () => {
      cancel = true;
    };
  }, [me.household.id, me.members]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Shell title={me.household.name}>
      <div className="topbar">
        <Wordmark />
        <button className="linkish" type="button" onClick={onSettings}>
          House
        </button>
      </div>
      <h1>{greeting}</h1>
      {me.household.demo && (
        <p className="callout">
          <strong>Sample house.</strong> Made-up days, so you can look around without a camera.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!stories && !error && <p className="loading">Reading the days…</p>}
      <div className="person-list">
        {people.map((person) => {
          const story = stories?.find((item) => item.member.id === person.id) ?? null;
          const latest = story?.latest ?? null;
          const today = latest !== null && dayLabel(latest.at) === 'Today';
          const recent = story ? story.days.slice(-7) : [];
          return (
            <article key={person.id} className="person">
              <button
                type="button"
                className="person-head"
                onClick={() => onStory(person.id)}
                aria-label={`See ${person.displayName}’s days`}
              >
                <span className="avatar" aria-hidden="true">
                  {person.displayName.charAt(0)}
                </span>
                <span className="person-name">
                  <strong>{person.displayName}</strong>
                  <span className="person-sub">
                    {!latest && 'No check-ins yet'}
                    {latest && today && (
                      <>
                        <Pebble status={latest.verdict.status} size={14} />{' '}
                        {STATUS_TITLE[latest.verdict.status]} today
                      </>
                    )}
                    {latest && !today && `Last check-in ${dayLabel(latest.at).toLowerCase()}`}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
              {recent.length > 0 && <PebbleStrip days={recent} size={34} />}
              <button className="btn moss wide" type="button" onClick={() => onCheckIn(person.id)}>
                {today ? 'Check in again' : `Check in with ${person.displayName}`}
              </button>
            </article>
          );
        })}
      </div>
      <Disclaimer />
    </Shell>
  );
}
