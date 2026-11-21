import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { dayLabel, houseWord } from '../format';
import type { Me, Story } from '../types';
import { Disclaimer, Shell, VerdictLabel, Wordmark } from '../components/ui';

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
  const carers = me.members.filter((member) => member.role === 'carer');
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
      <p className="kicker">{houseWord(me.household.code)}</p>
      <h1>{greeting}.</h1>
      {me.household.demo && (
        <p className="callout">
          This is the sample house. The days below are made up, so you can look around without a
          camera. A real check-in needs a Presage key on the server.
        </p>
      )}
      <p className="lede">
        {carers.length > 0
          ? `${carers.map((c) => c.displayName).join(' and ')} can see this too. `
          : ''}
        The camera stays off until a check-in starts, with the person there.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!stories && !error && <p>Reading the days…</p>}
      <div className="person-list">
        {people.map((person) => {
          const story = stories?.find((item) => item.member.id === person.id) ?? null;
          const latest = story?.latest ?? null;
          const today = latest && dayLabel(latest.at) === 'Today';
          return (
            <article key={person.id} className={`card ${today ? latest.verdict.status : ''}`}>
              <h3>{person.displayName}</h3>
              {!latest && <p>No check-ins yet. The first few are just a record.</p>}
              {latest && today && (
                <>
                  <VerdictLabel status={latest.verdict.status} headline={latest.verdict.headline} />
                  <p>{latest.verdict.explanation}</p>
                </>
              )}
              {latest && !today && (
                <>
                  <p>
                    <strong>No check-in yet today.</strong>
                  </p>
                  <p className="fine">
                    {dayLabel(latest.at)}:{' '}
                    {latest.verdict.headline
                      .replace(/^Looks like a usual day$/, 'looked like a usual day')
                      .replace(
                        /^Different from their usual days$/,
                        'different from their usual days',
                      )}
                  </p>
                </>
              )}
              <div className="stack">
                <button
                  className="btn leaf wide"
                  type="button"
                  onClick={() => onCheckIn(person.id)}
                >
                  Start {person.displayName}’s check-in
                </button>
                <button
                  className="btn secondary wide"
                  type="button"
                  onClick={() => onStory(person.id)}
                >
                  See the days
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <Disclaimer text={me.disclaimer} />
    </Shell>
  );
}
