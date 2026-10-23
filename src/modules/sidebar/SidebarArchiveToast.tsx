import { useEffect, useState } from 'react';
import { Archive, Check, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { SidebarArchiveToast as SidebarArchiveToastState } from '@/shared/types';

type SidebarArchiveToastProps = {
  toast: SidebarArchiveToastState | null;
  onUndo: () => void;
  onDismiss: () => void;
  t: TFunction;
};

// Long enough to notice and reach the undo button, short enough to stay out of
// the way. The restored confirmation has nothing to act on, so it goes sooner.
const ARCHIVED_TOAST_DURATION_MS = 6000;
const RESTORED_TOAST_DURATION_MS = 3000;

/** Rendered by Sidebar after an archive succeeds: a compact notice offering to undo it. */
export default function SidebarArchiveToast({
  toast,
  onUndo,
  onDismiss,
  t,
}: SidebarArchiveToastProps) {
  // Pauses auto-dismiss while the pointer is over the toast, so it cannot
  // vanish just as the user reaches for Undo.
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (!toast || isHovered) {
      return;
    }

    const duration = toast.kind === 'archived'
      ? ARCHIVED_TOAST_DURATION_MS
      : RESTORED_TOAST_DURATION_MS;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [toast, isHovered, onDismiss]);

  if (!toast) {
    return null;
  }

  const count = toast.sessionIds.length;
  // Plain keys with explicit defaults rather than i18next plural suffixes:
  // locales that do not translate this toast then fall back to English
  // instead of exposing a missing plural form.
  const message = toast.kind === 'archived'
    ? count === 1
      ? t('archiveToast.archived', 'Session archived')
      : t('archiveToast.archivedCount', { count, defaultValue: '{{count}} sessions archived' })
    : count === 1
      ? t('archiveToast.restored', 'Archive undone')
      : t('archiveToast.restoredCount', { count, defaultValue: '{{count}} sessions restored' });
  const StatusIcon = toast.kind === 'archived' ? Archive : Check;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 left-1/2 z-[9999] -translate-x-1/2 md:bottom-6"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="chat-activity-enter flex items-center gap-2 rounded-xl border border-border/70 bg-card/95 py-1.5 pl-2.5 pr-1.5 shadow-lg backdrop-blur">
        <StatusIcon
          className={
            toast.kind === 'archived'
              ? 'h-3.5 w-3.5 flex-shrink-0 text-muted-foreground'
              : 'h-3.5 w-3.5 flex-shrink-0 text-green-600 dark:text-green-400'
          }
        />
        <span className="max-w-60 truncate text-xs font-medium text-foreground">
          {message}
        </span>
        {toast.kind === 'archived' && (
          <button
            type="button"
            onClick={onUndo}
            className="rounded-md px-2 py-0.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {t('archiveToast.undo', 'Undo')}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('archiveToast.dismiss', 'Dismiss')}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
