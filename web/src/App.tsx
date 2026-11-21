import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Me } from './types';
import { CheckIn } from './screens/CheckIn';
import { Consent } from './screens/Consent';
import { CreateHouse } from './screens/CreateHouse';
import { Home } from './screens/Home';
import { Settings } from './screens/Settings';
import { StoryScreen } from './screens/Story';
import { SummaryScreen } from './screens/Summary';
import { Welcome } from './screens/Welcome';
import { Disclaimer, Shell } from './components/ui';

type Route =
  | { name: 'welcome' }
  | { name: 'create' }
  | { name: 'home' }
  | { name: 'consent'; memberId: string }
  | { name: 'checkin'; memberId: string; mode: 'live' | 'sample'; consentId: string | null }
  | { name: 'story'; memberId: string }
  | { name: 'summary'; memberId: string }
  | { name: 'settings' };

function parse(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  const query = new URLSearchParams(search);
  const head = parts[0];
  if (head === 'new') return { name: 'create' };
  if (head === 'home') return { name: 'home' };
  if (head === 'settings') return { name: 'settings' };
  if (head === 'consent' && parts[1]) return { name: 'consent', memberId: parts[1] };
  if (head === 'checkin' && parts[1]) {
    const mode = query.get('mode') === 'live' ? 'live' : 'sample';
    return { name: 'checkin', memberId: parts[1], mode, consentId: query.get('consent') };
  }
  if (head === 'story' && parts[1]) return { name: 'story', memberId: parts[1] };
  if (head === 'summary' && parts[1]) return { name: 'summary', memberId: parts[1] };
  return { name: 'welcome' };
}

function pathFor(route: Route): string {
  switch (route.name) {
    case 'welcome':
      return '/';
    case 'create':
      return '/new';
    case 'home':
      return '/home';
    case 'settings':
      return '/settings';
    case 'consent':
      return `/consent/${route.memberId}`;
    case 'checkin': {
      const query = new URLSearchParams({ mode: route.mode });
      if (route.consentId) query.set('consent', route.consentId);
      return `/checkin/${route.memberId}?${query.toString()}`;
    }
    case 'story':
      return `/story/${route.memberId}`;
    case 'summary':
      return `/summary/${route.memberId}`;
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname, location.search));
  const [me, setMe] = useState<Me | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await api<Me>('/api/me');
    setMe(next);
    return next;
  }, []);

  useEffect(() => {
    let cancel = false;
    refresh()
      .catch((err: unknown) => {
        if (cancel) return;
        if (err instanceof ApiError && err.status === 401) setMe(null);
        else setBootError(err instanceof ApiError ? err.message : 'The house did not open.');
      })
      .finally(() => {
        if (!cancel) setBooting(false);
      });
    const onPop = () => setRoute(parse(location.pathname, location.search));
    window.addEventListener('popstate', onPop);
    return () => {
      cancel = true;
      window.removeEventListener('popstate', onPop);
    };
  }, [refresh]);

  function go(next: Route) {
    const path = pathFor(next);
    history.pushState(null, '', path);
    setRoute(next);
  }

  if (booting) {
    return (
      <Shell title="Waking up">
        <h1>Waking the house up.</h1>
        <p className="lede">
          On a free host the first open can take a minute. The camera stays off until a check-in
          starts.
        </p>
      </Shell>
    );
  }

  if (bootError && !me) {
    return (
      <Shell title="Not open">
        <h1>The house did not open.</h1>
        <p className="lede">{bootError}</p>
        <button className="btn" type="button" onClick={() => location.reload()}>
          Try again
        </button>
        <Disclaimer />
      </Shell>
    );
  }

  const signedOut = !me;
  if (signedOut && route.name !== 'welcome' && route.name !== 'create') {
    return (
      <Welcome
        onEntered={() => {
          void refresh().then(() => go({ name: 'home' }));
        }}
        onCreate={() => go({ name: 'create' })}
      />
    );
  }

  if (route.name === 'create') {
    return (
      <CreateHouse
        onBack={() => go({ name: 'welcome' })}
        onReady={() => {
          void refresh().then(() => go({ name: 'home' }));
        }}
      />
    );
  }

  if (!me || route.name === 'welcome') {
    return (
      <Welcome
        onEntered={() => {
          void refresh().then(() => go({ name: 'home' }));
        }}
        onCreate={() => go({ name: 'create' })}
      />
    );
  }

  if (route.name === 'consent') {
    return (
      <Consent
        me={me}
        memberId={route.memberId}
        onBack={() => go({ name: 'home' })}
        onStart={(consentId, mode) =>
          go({ name: 'checkin', memberId: route.memberId, mode, consentId })
        }
      />
    );
  }

  if (route.name === 'checkin') {
    const person = me.members.find((member) => member.id === route.memberId);
    return (
      <CheckIn
        name={person?.displayName ?? 'Check-in'}
        memberId={route.memberId}
        mode={route.mode}
        consentId={route.consentId}
        onLeave={() => go({ name: 'home' })}
        onStory={() => go({ name: 'story', memberId: route.memberId })}
      />
    );
  }

  if (route.name === 'story') {
    return (
      <StoryScreen
        memberId={route.memberId}
        onBack={() => go({ name: 'home' })}
        onSummary={() => go({ name: 'summary', memberId: route.memberId })}
        onCheckIn={() => go({ name: 'consent', memberId: route.memberId })}
      />
    );
  }

  if (route.name === 'summary') {
    return (
      <SummaryScreen
        memberId={route.memberId}
        onBack={() => go({ name: 'story', memberId: route.memberId })}
      />
    );
  }

  if (route.name === 'settings') {
    return (
      <Settings
        me={me}
        onBack={() => go({ name: 'home' })}
        onChanged={async () => {
          await refresh();
        }}
        onLeave={() => {
          setMe(null);
          go({ name: 'welcome' });
        }}
      />
    );
  }

  return (
    <Home
      me={me}
      onCheckIn={(memberId) => go({ name: 'consent', memberId })}
      onStory={(memberId) => go({ name: 'story', memberId })}
      onSettings={() => go({ name: 'settings' })}
    />
  );
}
