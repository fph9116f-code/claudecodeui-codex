import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { useProviderSessionId } from '@/shared/hooks/useProviderSessionId';
import { copyTextToClipboard } from '@/shared/utils';

type CopyState = 'idle' | 'copying' | 'copied' | 'error';

/**
 * The provider session id behind a session row's "copy id" action.
 *
 * The fetch is gated on the menu being open rather than run for every row in
 * the list, and the id is dropped when the menu closes so a stale id is never
 * copied.
 *
 * `setOptionsOpen` is stable for a given session: ActionMenu takes it as
 * `onOpenChange` and depends on it in two document-listener effects, which
 * would otherwise be torn down and rebuilt on every keystroke.
 */
export function useProviderSessionIdCopy(sessionId: string, providerLabel: string) {
  // The menu's open state is what gates the request, so a row that is merely
  // rendered never pays for an id lookup.
  const [isOpen, setIsOpen] = useState(false);
  const { providerSessionId, status, reload } = useProviderSessionId(sessionId, isOpen);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const setOptionsOpen = useCallback((open: boolean) => {
    setIsOpen(open);
    // Drop a previous copy result so the next open shows the fresh fetch.
    setCopyState('idle');
  }, []);

  const copy = useCallback(async () => {
    if (!providerSessionId) {
      setCopyState('error');
      return;
    }

    setCopyState('copying');
    const didCopy = await copyTextToClipboard(providerSessionId);
    setCopyState(didCopy ? 'copied' : 'error');
  }, [providerSessionId]);

  // A failed fetch leaves nothing to copy, so the same control retries the
  // fetch instead; a failed clipboard write has an id and retries the write.
  const handleCopyAction = useCallback(() => {
    if (status === 'unavailable') {
      void reload();
    } else {
      void copy();
    }
  }, [copy, reload, status]);

  const copyLabel = status === 'loading'
    ? `Loading ${providerLabel} session ID…`
    : copyState === 'copied'
      ? `${providerLabel} session ID copied`
      : copyState === 'error'
        ? providerSessionId
          ? `Couldn't copy ${providerLabel} session ID`
          : `${providerLabel} session ID unavailable`
        : status === 'unavailable'
          ? `${providerLabel} session ID unavailable`
          : `Copy ${providerLabel} session ID`;

  // A failed lookup reads as an error to the menu, which offers a retry.
  const visibleCopyState: 'loading' | CopyState = status === 'loading'
    ? 'loading'
    : status === 'unavailable' && copyState === 'idle'
      ? 'error'
      : copyState;

  return {
    copyState: visibleCopyState,
    copyLabel,
    setOptionsOpen,
    handleCopyAction,
    isCopyPending: status === 'loading' || copyState === 'copying',
    CopyStateIcon: copyState === 'copied' ? Check : Copy,
  };
}
