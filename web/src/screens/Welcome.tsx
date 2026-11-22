import { useState } from 'react';
import { api, ApiError } from '../api';
import { Disclaimer, Mark, Shell, WhatThisIsNot } from '../components/ui';

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
      <section className="welcome-hero">
        <Mark size={120} nodding />
        <p className="wordmark-big">
          Nudge <em>&amp;</em> Nod
        </p>
        <h1>
          A gentle daily <span className="nowrap">check-in</span>, for people who don’t always say.
        </h1>
        <p className="lede">
          A minute with the phone camera. Tap a picture. Family sees whether today looks like their
          usual.
        </p>
      </section>
      <div className="stack">
        <button className="btn apricot wide" type="button" onClick={sample} disabled={busy}>
          Look around the sample house
        </button>
        <p className="fine center">
          For judges: house word <strong>maple</strong>, PIN <strong>2468</strong>.
        </p>
      </div>
      <form onSubmit={submit} className="card signin">
        <h2 className="card-title">Your house</h2>
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
        <button className="btn quiet wide" type="button" onClick={onCreate}>
          Start a new house
        </button>
      </form>
      <WhatThisIsNot />
      <Disclaimer full />
    </Shell>
  );
}
