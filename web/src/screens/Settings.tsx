import { useState } from 'react';
import { api, ApiError } from '../api';
import { TELEMETRY_NOTE } from '../copy';
import { houseWord } from '../format';
import type { Me } from '../types';
import { Disclaimer, Shell, WhatThisIsNot, Wordmark } from '../components/ui';

export function Settings({
  me,
  onChanged,
  onBack,
  onLeave,
}: {
  me: Me;
  onChanged: () => Promise<void>;
  onBack: () => void;
  onLeave: () => void;
}) {
  const [retention, setRetention] = useState(me.household.retentionDays);
  const [personName, setPersonName] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveRetention(days: 7 | 30 | 90) {
    setRetention(days);
    setError(null);
    try {
      await api('/api/household', {
        method: 'PATCH',
        body: JSON.stringify({ retentionDays: days }),
      });
      setMessage(`Check-ins older than ${days} days are removed.`);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save.');
    }
  }

  async function addPerson(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/members', {
        method: 'POST',
        body: JSON.stringify({ displayName: personName }),
      });
      setPersonName('');
      setMessage('Added. They can have their own check-ins.');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add them.');
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/data', { method: 'DELETE', body: JSON.stringify({ confirm: 'delete' }) });
      setConfirm('');
      setMessage('Check-ins, notes, and agreements are gone. The house word, PIN, and names stay.');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The delete did not finish.');
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/demo/restore', { method: 'POST' });
      setMessage('The made-up days are back. Anything you had added in this house was replaced.');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restore the sample.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api('/api/session', { method: 'DELETE' }).catch(() => undefined);
    onLeave();
  }

  return (
    <Shell title="House">
      <div className="topbar">
        <Wordmark />
        <button className="linkish" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      <p className="kicker">{me.household.name}</p>
      <h1>House word</h1>
      <p className="house-word">{houseWord(me.household.code)}</p>
      <p>
        Anyone with this word and the PIN can see the check-ins. The PIN is not shown again. It is a
        small lock for a demo, not a hospital login: four to six digits, slowed after repeated
        misses.
      </p>
      <h2>How long we keep days</h2>
      <div className="segmented" role="group" aria-label="Retention">
        {[7, 30, 90].map((days) => (
          <button
            key={days}
            className="btn secondary"
            type="button"
            aria-pressed={retention === days}
            onClick={() => void saveRetention(days as 7 | 30 | 90)}
          >
            {days} days
          </button>
        ))}
      </div>
      <p className="fine">
        Older check-ins are deleted on their own. On the free host, a restart can also forget the
        database. Don’t treat this as the only copy that matters.
      </p>
      <h2>Add someone</h2>
      <form onSubmit={addPerson}>
        <div className="field">
          <label htmlFor="someone">Their name</label>
          <input
            id="someone"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            required
          />
        </div>
        <button className="btn secondary" type="submit" disabled={busy}>
          Add to the house
        </button>
      </form>
      <h2>Download the history</h2>
      <p>
        A JSON file of names, agreements, pictures tapped, notes, and the numbers, including how
        many steady seconds each signal had. No video. Withdrawing an agreement does not create this
        file, and downloading it does not delete anything.
      </p>
      <a className="btn secondary" href="/api/export">
        Download JSON
      </a>
      <WhatThisIsNot />
      <h2>What happens to the picture</h2>
      <p className="narrative">{TELEMETRY_NOTE}</p>
      <p>
        Live signals right now:{' '}
        {me.live.keyConfigured && me.live.sdkPresent
          ? 'the server has a Presage key and the library.'
          : 'the camera check-in is not ready. The sample check-in still is.'}{' '}
        Telemetry is {me.live.telemetry ? 'on' : 'off'}.
      </p>
      <h2>Delete all our data</h2>
      <p>
        This removes check-ins, notes, pictures tapped, and agreements. Names and the house word
        stay, so you can still come in. A printed summary is already out of our hands.
      </p>
      <div className="field">
        <label htmlFor="confirm">Type delete to confirm</label>
        <input
          id="confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoCapitalize="none"
        />
      </div>
      <button
        className="btn clay"
        type="button"
        disabled={confirm.trim().toLowerCase() !== 'delete' || busy}
        onClick={() => void wipe()}
      >
        Delete all our data
      </button>
      {me.household.demo && (
        <>
          <h2>Sample days</h2>
          <p>
            Put June and Arthur’s made-up days back. This replaces whatever is in the Maple house.
          </p>
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={() => void restore()}
          >
            Restore sample days
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p>
        <button className="btn quiet" type="button" onClick={() => void logout()}>
          Leave this house
        </button>
      </p>
      <Disclaimer text={me.disclaimer} />
    </Shell>
  );
}
