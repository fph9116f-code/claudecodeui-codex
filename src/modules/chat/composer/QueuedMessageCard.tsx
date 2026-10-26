import { useTranslation } from 'react-i18next';
import { CornerUpRightIcon, Loader2, PencilIcon, RotateCcwIcon, SkipForwardIcon, XIcon } from 'lucide-react';

import type { ChatQueueMessage } from '@/shared/types';

type QueuedMessageCardProps = {
  message: ChatQueueMessage;
  queuePaused: boolean;
  pauseReason: string | null;
  isEditing: boolean;
  /** True while this session has a turn in flight that the message can steer. */
  canInsertNow: boolean;
  /** The insert request for this message is in flight. */
  inserting: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onSkip: () => void;
  onInsertNow: () => void;
};

/**
 * Rendered by chat's ChatComposer for each message the server holds for a busy
 * session: waiting, sending, steered into the current turn, or stopped so the
 * user can retry or skip it.
 */
export default function QueuedMessageCard({
  message,
  queuePaused,
  pauseReason,
  isEditing,
  canInsertNow,
  inserting,
  onEdit,
  onCancelEdit,
  onDelete,
  onRetry,
  onSkip,
  onInsertNow,
}: QueuedMessageCardProps) {
  const { t } = useTranslation('chat');
  const attachmentCount = message.attachments.length;
  const isPending = message.status === 'pending';
  const isRunning = message.status === 'running' || message.status === 'steering';
  const isSteered = message.status === 'steered';
  const isFailed = message.status === 'failed' || message.status === 'unknown';
  // The paused state belongs to the session, but only the failed turn caused
  // it — showing it on the retryable card is the actionable place.
  const showPause = isFailed && queuePaused;

  const statusLabel = message.status === 'steering'
    ? t('input.queue.inserting', { defaultValue: 'Inserting…' })
    : isSteered
      ? t('input.queue.inserted', { defaultValue: 'Inserted into this turn' })
      : isRunning
        ? t('input.queue.sending', { defaultValue: 'Sending…' })
        : message.status === 'unknown'
          ? t('input.queue.unknown', { defaultValue: 'Outcome unknown' })
          : isFailed
            ? t('input.queue.failed', { defaultValue: 'Send failed' })
            : t('input.queue.label', { defaultValue: 'Queued' });
  const statusDetail = isPending
    ? t('input.queue.willSend', { defaultValue: 'Will send when this finishes' })
    : null;

  return (
    <div
      className={`settings-content-enter mx-auto max-w-[54.25rem] rounded-xl rounded-t-none border border-dashed px-3 py-2 ${
        isFailed
          ? 'border-destructive/30 bg-destructive/[0.04]'
          : 'border-primary/25 bg-primary/[0.04]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
            isFailed ? 'bg-destructive/60' : 'bg-primary/60'
          }`}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div
            className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${
              isFailed ? 'text-destructive/80' : 'text-primary/70'
            }`}
          >
            <span>{statusLabel}</span>
            {statusDetail && (
              <span className="normal-case text-muted-foreground/60">· {statusDetail}</span>
            )}
            {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}            {isEditing && (
              <span className="normal-case text-amber-600 dark:text-amber-400">
                · {t('input.queue.editing', { defaultValue: 'Editing' })}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 break-words text-sm text-foreground/90">
            {message.content}
          </p>
          {attachmentCount > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {attachmentCount} {attachmentCount === 1 ? 'file' : 'files'} attached
            </p>
          )}
          {showPause && (
            <p className="mt-1 text-xs text-destructive/90">
              {pauseReason
                || t('input.queue.paused', { defaultValue: 'The queue is paused. Retry or skip this message to continue.' })}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {isPending && !isEditing && canInsertNow && (
            <button
              type="button"
              onClick={onInsertNow}
              disabled={inserting}
              aria-label={t('input.queue.insertNow', { defaultValue: 'Insert into current turn' })}
              title={t('input.queue.insertNow', { defaultValue: 'Insert into current turn' })}
              className="rounded-md p-1.5 text-primary/80 transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-default disabled:opacity-60"
            >
              {inserting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CornerUpRightIcon className="h-3.5 w-3.5" />}
            </button>
          )}
          {isPending && !isEditing && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
              title={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {isEditing && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {t('input.queue.cancelEdit', { defaultValue: 'Cancel edit' })}
            </button>
          )}
          {isPending && !isEditing && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
              title={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {isFailed && (
            <>
              <button
                type="button"
                onClick={onRetry}
                aria-label={t('input.queue.retry', { defaultValue: 'Retry' })}
                title={t('input.queue.retry', { defaultValue: 'Retry' })}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCcwIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onSkip}
                aria-label={t('input.queue.skip', { defaultValue: 'Skip' })}
                title={t('input.queue.skip', { defaultValue: 'Skip' })}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <SkipForwardIcon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
