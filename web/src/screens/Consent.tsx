import { useState } from 'react';
import { api, ApiError } from '../api';
import type { Me } from '../types';
import { Disclaimer, Shell, WhatThisIsNot, Wordmark } from '../components/ui';

export function Consent({
  me,
  memberId,
  onBack,
  onStart,
}: {
  me: Me;
  memberId: string;
  onBack: () => void;
  onStart: (consentId: string | null, mode: 'live' | 'sample') => void;
}) {
  const person = me.members.find((member) => member.id === memberId);
  const [agreedAs, setAgreedAs] = useState<'self' | 'with_them' | null>(null);
  const [consenterName, setConsenterName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const liveReady = me.live.keyConfigured && me.live.sdkPresent && !me.live.busy;
  const name = person?.displayName ?? 'them';

  async function start(mode: 'live' | 'sample') {
    if (!agreedAs || !person || consenterName.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'live') {
        const result = await api<{ consent: { id: string } }>('/api/consents', {
          method: 'POST',
          body: JSON.stringify({
            memberId: person.id,
            agreedAs,
            consenterName: consenterName.trim(),
          }),
        });
        onStart(result.consent.id, 'live');
      } else {
        onStart(null, 'sample');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The agreement did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!person || person.role !== 'person') {
    return (
      <Shell title="Check-in">
        <p>That person is not in this house.</p>
        <button className="btn" type="button" onClick={onBack}>
          Back
        </button>
      </Shell>
    );
  }

  return (
    <Shell title={`Agree with ${name}`}>
      <Wordmark />
      <button className="linkish" type="button" onClick={onBack}>
        Back
      </button>
      <p className="kicker">Before the camera</p>
      <h1>Who is agreeing?</h1>
      <p className="lede">
        The check-in is for <strong>{name}</strong>. It only happens with them here. People with
        this house’s word and PIN can see the numbers, the picture they tap, and any note that is
        typed.
      </p>
      <ul>
        <li>
          The camera turns on only after this, and a “camera is on” sign stays up. Stop is always on
          screen.
        </li>
        <li>Picture frames go to this server, are read in memory, and are not saved.</li>
        <li>
          We keep pulse, breathing, and — if you stay about a minute — beat-to-beat numbers, plus
          the picture and any typed note.
        </li>
        <li>We do not use an AI service, and we do not record a voice.</li>
      </ul>
      <div className="field">
        <label htmlFor="who-name">Name of the person agreeing</label>
        <input
          id="who-name"
          value={consenterName}
          onChange={(event) => setConsenterName(event.target.value)}
          autoComplete="name"
        />
        <p className="fine">
          We keep this name, who the check-in is for, whether you agreed as yourself or with them,
          the time, and agreement version {me.consentVersion}. Withdrawing later stops the camera.
          It does not delete days already kept. Deleting is a separate step in House.
        </p>
      </div>
      <label className="choice">
        <input
          type="radio"
          name="who"
          checked={agreedAs === 'self'}
          onChange={() => setAgreedAs('self')}
        />
        <span>
          <strong>I am {name}, and I agree.</strong>
        </span>
      </label>
      <label className="choice">
        <input
          type="radio"
          name="who"
          checked={agreedAs === 'with_them'}
          onChange={() => setAgreedAs('with_them')}
        />
        <span>
          <strong>I am with {name}.</strong> They are here, and I am agreeing with them.
        </span>
      </label>
      <div className="card">
        <h2>A steadier picture</h2>
        <p>Prop the phone so it does not wobble. Breathing is hard to see from a hand.</p>
        <p>Face a window or a lamp. Not a bright window behind you.</p>
        <p>
          One person in the picture. Face and the top of the chest both visible. Lighter clothes
          help.
        </p>
      </div>
      {me.live.busy && (
        <p className="callout">
          Someone is already checking in. This server can watch one person at a time.
        </p>
      )}
      {!me.live.keyConfigured && (
        <p className="callout">
          No Presage key is set on the server, so the live camera cannot start. The sample check-in
          still can. It uses made-up signals and leaves the camera off.
        </p>
      )}
      {me.live.keyConfigured && !me.live.sdkPresent && (
        <p className="callout">
          The measurement library is not loaded on this server. The sample check-in still works.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="stack">
        <button
          className="btn leaf wide"
          type="button"
          disabled={!agreedAs || consenterName.trim().length === 0 || !liveReady || busy}
          onClick={() => start('live')}
        >
          Start the camera
        </button>
        <button
          className="btn secondary wide"
          type="button"
          disabled={!agreedAs || consenterName.trim().length === 0 || busy}
          onClick={() => start('sample')}
        >
          Try the sample instead — camera stays off
        </button>
      </div>
      <WhatThisIsNot />
      <Disclaimer text={me.disclaimer} />
    </Shell>
  );
}
