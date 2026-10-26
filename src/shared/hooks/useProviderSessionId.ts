import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';

/** Lifecycle of the provider-native id lookup rendered by the workspace header and sidebar menu. */
type ProviderSessionIdStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

type ProviderSessionIdLookup = {
  /** The session the result belongs to, so a result is never shown under another session. */
  sessionId: string | null;
  providerSessionId: string | null;
  status: ProviderSessionIdStatus;
};

const IDLE_LOOKUP: ProviderSessionIdLookup = {
  sessionId: null,
  providerSessionId: null,
  status: 'idle',
};

/**
 * Resolves the provider-native session id behind an app-facing session id.
 *
 * The id is not part of the sidebar payload because it costs a request, so
 * callers opt in with `enabled` — the sidebar menu fetches it only while the
 * menu is open, and the workspace header fetches it once per selected session.
 *
 * A reply that lands after the session changed is discarded, so one session's
 * id can never be shown or copied under another session's title.
 */
export function useProviderSessionId(sessionId: string | null, enabled = true) {
  const [lookup, setLookup] = useState<ProviderSessionIdLookup>(IDLE_LOOKUP);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    const requestId = ++requestRef.current;
    setLookup({ sessionId, providerSessionId: null, status: 'loading' });
    try {
      const response = await api.providerSessionId(sessionId);
      const payload = await response.json();
      const loadedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof loadedSessionId !== 'string' || !loadedSessionId) {
        throw new Error('Provider session ID is unavailable');
      }

      if (requestId !== requestRef.current) return;
      setLookup({ sessionId, providerSessionId: loadedSessionId, status: 'ready' });
    } catch {
      if (requestId !== requestRef.current) return;
      setLookup({ sessionId, providerSessionId: null, status: 'unavailable' });
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !enabled) {
      // Invalidate any in-flight reply; the derived values below already read
      // as idle while the lookup is disabled or the session moved on.
      requestRef.current += 1;
      return;
    }

    void load();
  }, [sessionId, enabled, load]);

  // Derived rather than reset through state: closing a menu or switching
  // sessions must not leave the previous session's id visible for a render.
  const isCurrent = enabled && Boolean(sessionId) && lookup.sessionId === sessionId;
  const providerSessionId = isCurrent ? lookup.providerSessionId : null;
  const status = isCurrent ? lookup.status : 'idle';

  return { providerSessionId, status, reload: load };
}
