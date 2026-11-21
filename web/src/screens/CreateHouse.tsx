import { useState } from 'react';
import { api, ApiError } from '../api';
import { houseWord } from '../format';
import type { Household, Member } from '../types';
import { Disclaimer, Shell, Wordmark } from '../components/ui';

export function CreateHouse({ onReady, onBack }: { onReady: () => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [carerName, setCarerName] = useState('');
  const [personName, setPersonName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ household: Household; members: Member[] } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ household: Household; members: Member[] }>('/api/households', {
        method: 'POST',
        body: JSON.stringify({ name, carerName, personName, pin }),
      });
      setCreated(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The house was not created.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Shell title="Your house word">
        <Wordmark />
        <p className="kicker">Write this down</p>
        <h1>Your house word</h1>
        <p className="house-word">{houseWord(created.household.code)}</p>
        <p className="lede">
          You will need this word and the PIN on every phone. Anyone with both can see the
          check-ins. Treat them like a house key. The word is also kept under House.
        </p>
        <button className="btn wide" type="button" onClick={onReady}>
          I’ve written it down
        </button>
        <Disclaimer />
      </Shell>
    );
  }

  return (
    <Shell title="Start a house">
      <Wordmark />
      <button className="linkish" type="button" onClick={onBack}>
        Back
      </button>
      <h1>Start a house</h1>
      <p className="lede">
        A house is the small circle who can see the check-ins. One person is looked after. One
        person holds the key with them. You can add more people later.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="house">House name</label>
          <input
            id="house"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            placeholder="The Hart house"
          />
        </div>
        <div className="field">
          <label htmlFor="carer">Your name</label>
          <input
            id="carer"
            type="text"
            value={carerName}
            onChange={(e) => setCarerName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="person">Their name</label>
          <input
            id="person"
            type="text"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-pin">A PIN, 4 to 6 digits</label>
          <input
            id="new-pin"
            type="text"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            autoComplete="new-password"
            pattern="\d{4,6}"
            required
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn wide" type="submit" disabled={busy}>
          {busy ? 'Making the house…' : 'Make the house'}
        </button>
      </form>
      <Disclaimer />
    </Shell>
  );
}
