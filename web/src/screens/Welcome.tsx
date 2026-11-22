import { useState } from 'react';
import { api, ApiError } from '../api';
import { Disclaimer, Shell, WhatThisIsNot, Wordmark } from '../components/ui';

export function Welcome({ onEntered, onCreate }: { onEntered: () => void; onCreate: () => void }) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/session', {
        method: 'POST',
        body: JSON.stringify({ code, pin }),
      });
      onEntered();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not come in.');
    } finally {
      setBusy(false);
    }
  }

  async function sample() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/session', {
        method: 'POST',
        body: JSON.stringify({ code: 'maple', pin: '2468' }),
      });
      onEntered();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The sample house did not open.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Come in">
      <Wordmark />
      <p className="kicker">A daily nudge, any kind of nod</p>
      <h1>How was today, really?</h1>
      <p className="lede">
        For someone who may not say much, and for the people who look after them. A nudge is the
        gentle ask. A nod is any answer: a picture, a few typed words, or simply sitting where the
        camera can see.
      </p>
      <form onSubmit={submit} className="card">
        <div className="field">
          <label htmlFor="code">House word</label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            type="text"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            inputMode="numeric"
            autoComplete="current-password"
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
          {busy ? 'Opening…' : 'Come in'}
        </button>
      </form>
      <div className="stack" style={{ marginTop: '0.9rem' }}>
        <button className="btn secondary wide" type="button" onClick={onCreate}>
          Start a house
        </button>
        <div className="callout">
          <p>
            <strong>Judges and visitors.</strong> The sample house word is <strong>maple</strong>,
            PIN <strong>2468</strong>. June and Arthur’s days are made up.
          </p>
          <button className="btn leaf wide" type="button" onClick={sample} disabled={busy}>
            Look around the sample house
          </button>
        </div>
      </div>
      <WhatThisIsNot />
      <Disclaimer />
    </Shell>
  );
}
