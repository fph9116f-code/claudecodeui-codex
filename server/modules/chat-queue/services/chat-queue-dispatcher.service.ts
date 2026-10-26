import { randomUUID } from 'node:crypto';

import { chatQueueDb, sessionsDb } from '@/modules/database/index.js';
import type { ChatQueueMessageRecord } from '@/modules/database/index.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';
import type { LLMProvider } from '@/shared/types.js';
import { setChatQueueDrainTrigger, toChatQueueMessage } from '@/modules/chat-queue/services/chat-queue.service.js';
import { chatQueueService } from '@/modules/chat-queue/services/chat-queue.service.js';
import type { ChatQueueMessage } from '@/modules/chat-queue/services/chat-queue.service.js';

/**
 * Recovery scan interval. The queue is normally drained the moment a turn
 * finishes (the run registry notifies us) or a message is queued; this poll
 * only recovers triggers that were lost (a restart, a background task that
 * settled without a terminal run event).
 */
const POLL_INTERVAL_MS = 30_000;

/** Consecutive start failures before the message is shown as failed instead of retried. */
const MAX_START_ATTEMPTS = 5;

/** Backoff for a message the runtime refused to start. */
const START_RETRY_MAX_DELAY_MS = 5 * 60_000;

/** The run registry and the reservation are separate; a lost race is retried soon. */
const BUSY_RETRY_DELAY_MS = 5_000;

/** The start error `runDetachedChatTurn` returns when another turn won the race. */
const RUN_IN_PROGRESS_ERROR = 'A run was already in progress for this session.';

/**
 * Sessions with a drain loop running in this process.
 *
 * The loop awaits the whole provider run, so this is what keeps a second
 * trigger from starting a parallel worker for the same session. It is per
 * session on purpose: one long turn must not stop other sessions' queues —
 * that was the old global dispatch lock's failure mode.
 */
const drainingSessions = new Set<string>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let runtimeGateway: ProviderRuntimeGateway | null = null;

/** A run is in flight, or its session still has work the next turn would stop. */
function isSessionBusy(sessionId: string, runtime: ProviderRuntimeGateway): boolean {
  return chatRunRegistry.isProcessing(sessionId)
    || runtime.hasBackgroundWork(sessionId)
    // A steered ('now') message is answered in the live process after the
    // turn's terminal result; starting a new run would supersede that process.
    || Boolean(runtime.isSteering?.(sessionId));
}

function startRetryDelayMs(attempts: number): number {
  // attempts is already incremented by the claim.
  return Math.min(
    POLL_INTERVAL_MS * 2 ** Math.max(0, attempts - 1),
    START_RETRY_MAX_DELAY_MS
  );
}

/**
 * Start errors no retry can fix: the session row is gone or its provider
 * runtime is not registered in this process. Keeping those would leave an
 * unsendable row behind forever.
 */
function isPermanentStartFailure(error: string | null): boolean {
  return error === 'The session no longer exists.'
    || (typeof error === 'string'
      && error.startsWith('Provider "')
      && error.endsWith('" is not available.'));
}

/** Logs a start failure the way the composer would show it: the card cannot show a reason yet. */
function logQueueFailure(
  record: ChatQueueMessageRecord,
  phase: string,
  error: string | null
): void {
  console.error('[ChatQueue] Queued turn did not complete; the session queue is paused', {
    sessionId: record.session_id,
    messageId: record.id,
    attempts: record.attempts,
    phase,
    error: error ?? 'unknown error',
  });
}

/**
 * Runs one claimed message and reports whether the loop may continue.
 *
 * The outcome rules are the point of this dispatcher:
 * - delivered → delete the row and continue with the next message;
 * - the runtime accepted it and then failed (or was aborted) → mark failed and
 *   stop. Such a turn may already have changed files or run commands, so it is
 *   never replayed automatically;
 * - the runtime never accepted it → keep it pending with a bounded backoff;
 * - the outcome is unknown (an exception) → mark unknown and stop.
 */
async function runClaimedMessage(
  record: ChatQueueMessageRecord,
  runtime: ProviderRuntimeGateway
): Promise<boolean> {
  const message = toChatQueueMessage(record);

  let result: { started: boolean; error: string | null; aborted: boolean };
  try {
    result = await runDetachedChatTurn(
      {
        sessionId: record.session_id,
        userId: record.user_id,
        content: message.content,
        options: { ...message.options, attachments: message.attachments },
      },
      { runtime },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // The dispatcher cannot tell whether the provider accepted the turn before
    // throwing, so this is not safe to replay.
    chatQueueDb.markFailed(record.id, reason, 'unknown');
    logQueueFailure(record, 'the dispatch threw', reason);
    return false;
  }

  if (result.started && !result.error && !result.aborted) {
    // Kept as the request-id receipt so a retried submit cannot run again.
    chatQueueDb.markDelivered(record.id);
    return true;
  }

  if (result.started) {
    const reason = result.aborted
      ? 'The run was interrupted before it finished.'
      : result.error ?? 'The run failed.';
    chatQueueDb.markFailed(record.id, reason, 'failed');
    logQueueFailure(record, result.aborted ? 'the run was aborted' : 'the run failed after starting', reason);
    return false;
  }

  if (isPermanentStartFailure(result.error)) {
    chatQueueDb.markFailed(record.id, result.error ?? 'The session is no longer available.', 'failed');
    logQueueFailure(record, 'the session or provider is gone', result.error);
    return false;
  }

  if (result.error === RUN_IN_PROGRESS_ERROR) {
    // Not a failure: another turn started in the gap between the busy check
    // and the claim. Its completion triggers another drain.
    chatQueueDb.reschedule(record.id, result.error, new Date(Date.now() + BUSY_RETRY_DELAY_MS));
    return false;
  }

  if (record.attempts >= MAX_START_ATTEMPTS) {
    const reason = `Could not start after ${record.attempts} attempts: ${result.error ?? 'unknown error'}`;
    chatQueueDb.markFailed(record.id, reason, 'failed');
    logQueueFailure(record, 'start retries exhausted', reason);
    return false;
  }

  chatQueueDb.reschedule(
    record.id,
    result.error ?? 'The run did not start.',
    new Date(Date.now() + startRetryDelayMs(record.attempts))
  );
  console.warn('[ChatQueue] Queued turn could not start; retrying later', {
    sessionId: record.session_id,
    messageId: record.id,
    attempts: record.attempts,
    error: result.error ?? 'unknown error',
  });
  return false;
}

/**
 * Drains one session's queue in FIFO order.
 *
 * Exported for tests and for the run-settled trigger. It holds the per-session
 * worker guard for the whole loop, but only for this session: other sessions
 * drain independently.
 */
export async function drainSessionQueue(
  sessionId: string,
  runtime: ProviderRuntimeGateway
): Promise<void> {
  if (drainingSessions.has(sessionId)) {
    return;
  }
  drainingSessions.add(sessionId);

  try {
    for (;;) {
      const userId = chatQueueDb.findPendingOwner(sessionId);
      if (userId === null) {
        return;
      }

      // A failed or uncertain turn pauses the session: the user has to decide
      // whether to retry it or continue past it before anything else runs.
      if (chatQueueDb.hasBlockingFailure(userId, sessionId)) {
        return;
      }

      if (isSessionBusy(sessionId, runtime)) {
        return;
      }

      const claimed = chatQueueDb.claimNext(userId, sessionId, randomUUID());
      if (!claimed) {
        return;
      }

      const shouldContinue = await runClaimedMessage(claimed, runtime);
      if (!shouldContinue) {
        return;
      }
    }
  } finally {
    drainingSessions.delete(sessionId);
  }
}

/**
 * Recovery scan: starts a drain for every session with a pending message and
 * returns immediately. Deliberately does not await the runs — one long turn
 * must not hold the scan (or other sessions) open.
 */
export function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): number {
  const sessions = chatQueueDb.listSessionsWithPending();
  for (const session of sessions) {
    startDrain(session.session_id, runtime);
  }
  return sessions.length;
}

/**
 * Starts a drain in the background. A drain failure (a database error, say)
 * must not take down the poll or the caller's event loop.
 */
function startDrain(sessionId: string, runtime: ProviderRuntimeGateway): void {
  void drainSessionQueue(sessionId, runtime).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ChatQueue] Drain failed', { sessionId, error: message });
  });
}

/** Entry point for "something changed" triggers (enqueue, retry, run settled). */
export function triggerChatQueueDrain(sessionId: string): void {
  if (!runtimeGateway) {
    return;
  }
  startDrain(sessionId, runtimeGateway);
}

/**
 * Whether "insert now" can reach a live turn for this session.
 *
 * The client uses this instead of `isProcessing`: after a steer the registry
 * has already marked the original turn completed while the CLI keeps answering
 * in the same process. Exposed through the queue snapshot.
 */
export function canInsertIntoSession(sessionId: string): boolean {
  if (!runtimeGateway) {
    return false;
  }
  return chatRunRegistry.isProcessing(sessionId)
    || Boolean(runtimeGateway.isSteering?.(sessionId));
}

/**
 * Inserts one pending message into the turn currently in flight ("insert now").
 *
 * Unlike the dispatcher, this does not wait for the session to become idle: it
 * pushes the message into the live CLI input with `priority: 'now'`, so the
 * running turn is steered rather than aborted or restarted. The row becomes
 * `steered` and is removed when that turn settles; a server restart turns it
 * into `unknown` instead of sending it again.
 *
 * Used by the Chat Queue routes; resolves only after the runtime accepted the
 * message, and throws a 409 when there is no live turn to insert into.
 */
export async function insertQueuedMessageNow(
  userId: number,
  messageId: string,
  runtime: ProviderRuntimeGateway | null = runtimeGateway,
): Promise<void> {
  const record = chatQueueDb.findById(userId, messageId);
  if (!record) {
    throw new AppError('That queued message no longer exists.', {
      code: 'QUEUE_MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
  }
  if (record.status !== 'pending') {
    throw new AppError('That message is already being sent or was already inserted.', {
      code: 'QUEUE_MESSAGE_NOT_PENDING',
      statusCode: 409,
    });
  }

  const session = sessionsDb.getSessionById(record.session_id);
  if (!session) {
    throw new AppError('The session for that queued message no longer exists.', {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (!runtime || typeof runtime.injectUserMessage !== 'function') {
    throw new AppError('This provider cannot insert a message into a running turn.', {
      code: 'QUEUE_INSERT_UNSUPPORTED',
      statusCode: 409,
    });
  }

  // Reserve before touching the runtime. Two quick clicks both read `pending`;
  // without this transition they both inject and only then race on the status,
  // delivering the text twice.
  if (!chatQueueDb.claimForInsert(record.id)) {
    throw new AppError('That message is already being sent.', {
      code: 'QUEUE_MESSAGE_NOT_PENDING',
      statusCode: 409,
    });
  }

  // Do NOT gate this on `chatRunRegistry.isProcessing`: after a steer the CLI
  // ends the original turn's result (the registry marks it completed) and then
  // answers the steered message in the same live process. The input stream is
  // the source of truth, so a false result from it is what means "nothing to
  // steer" — a second insert during that follow-up must still work.
  const message = toChatQueueMessage(record);
  let inserted = false;
  try {
    inserted = await runtime.injectUserMessage(
      session.provider as LLMProvider,
      record.session_id,
      { content: message.content, attachments: message.attachments },
    );
  } catch (error) {
    // The reservation is taken but we cannot know whether the write reached
    // the CLI. Keep the message visible as unknown rather than replaying it.
    const reason = error instanceof Error ? error.message : String(error);
    chatQueueDb.markSteeredOutcome(record.id, reason, 'unknown');
    throw new AppError('The message could not be inserted into the running turn.', {
      code: 'QUEUE_INSERT_FAILED',
      statusCode: 502,
    });
  }

  if (!inserted) {
    // Confirmed not accepted: safe to wait for the next turn.
    chatQueueDb.revertSteering(record.id, 'The session had no live turn to insert into.');
    throw new AppError('This session has no turn in flight to insert into.', {
      code: 'QUEUE_NO_ACTIVE_RUN',
      statusCode: 409,
    });
  }

  // From here the runtime owns delivery: the steer outcome listener settles the
  // row (delivered / failed / unknown). It is never deleted up front.
  if (!chatQueueDb.markSteered(record.id)) {
    console.error('[ChatQueue] Lost the steering claim for an inserted message', {
      sessionId: record.session_id,
      messageId: record.id,
    });
  }
}

/**
 * Best-effort variant of `insertQueuedMessageNow` for the composer's button.
 *
 * A turn that ended between the click and the request (or a provider that
 * cannot steer) is not an error: the message is still in the queue and will be
 * sent normally. Only unexpected failures propagate.
 */
export async function tryInsertQueuedMessageNow(
  userId: number,
  messageId: string,
  runtime: ProviderRuntimeGateway | null = runtimeGateway,
): Promise<boolean> {
  try {
    await insertQueuedMessageNow(userId, messageId, runtime);
    return true;
  } catch (error) {
    if (
      error instanceof AppError
      && (
        error.code === 'QUEUE_NO_ACTIVE_RUN'
        || error.code === 'QUEUE_INSERT_UNSUPPORTED'
        || error.code === 'QUEUE_MESSAGE_NOT_PENDING'
      )
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Submits a message that should steer the turn in flight ("insert now").
 *
 * The message is written to the durable queue first, then pushed into the
 * running turn. When the turn cannot accept it — it ended between typing and
 * sending, or the provider cannot steer — the message simply stays queued, so
 * the user's text is never lost to a failed steer. The response says which of
 * the two happened.
 *
 * Used by the Chat Queue routes for the composer's insert-now action.
 */
export async function steerMessageNow(
  userId: number,
  input: {
    sessionId: unknown;
    requestId?: unknown;
    content?: unknown;
    options?: unknown;
    attachments?: unknown;
  },
  runtime: ProviderRuntimeGateway | null = runtimeGateway,
): Promise<{ inserted: boolean; message: ChatQueueMessage }> {
  const message = chatQueueService.append({ userId, ...input });
  const inserted = await tryInsertQueuedMessageNow(userId, message.id, runtime);
  return { inserted, message };
}

/**
 * Starts the queue dispatcher.
 *
 * Called once by the server composition root. Marks runs a previous process
 * left in flight as `unknown` (never replayed), wires the run-completion
 * trigger, and keeps the slow recovery poll as a backstop.
 */
export function initializeChatQueueDispatcher(runtime: ProviderRuntimeGateway): void {
  runtimeGateway = runtime;
  setChatQueueDrainTrigger(triggerChatQueueDrain);
  runtime.setSteerOutcomeListener?.((outcome) => {
    // The live process reports what happened to the messages inserted into it.
    // Nothing is deleted: a delivered row stays as the request-id receipt.
    if (outcome.status === 'delivered') {
      chatQueueDb.markSteeredDeliveredForSession(outcome.sessionId);
      return;
    }
    chatQueueDb.markSteeredFailedForSession(
      outcome.sessionId,
      outcome.error ?? (outcome.status === 'failed'
        ? 'The inserted message could not be completed.'
        : 'The run ended before the inserted message was confirmed.'),
      outcome.status,
    );
  });
  chatRunRegistry.setRunSettledHandler((sessionId) => {
    // Steered rows are settled by the runtime's outcome listener, not by this
    // turn's complete: the inserted message may still be running in the same
    // process. Only decide whether the queue may continue.
    if (runtime.isSteering?.(sessionId)) {
      return;
    }
    startDrain(sessionId, runtime);
  });

  const interrupted = chatQueueDb.markInterruptedAsUnknown(
    'The server stopped while this message was being sent.'
  );
  if (interrupted > 0) {
    console.warn('[ChatQueue] Marked messages with an unknown outcome', { count: interrupted });
  }

  if (pollTimer) {
    return;
  }
  pollTimer = setInterval(() => dispatchQueuedMessages(runtime), POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for queued messages.
  pollTimer.unref?.();

  // Catch up on anything that was queued while the server was not running.
  dispatchQueuedMessages(runtime);
}

export function closeChatQueueDispatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  chatRunRegistry.setRunSettledHandler(null);
  runtimeGateway?.setSteerOutcomeListener?.(null);
  setChatQueueDrainTrigger(null);
  runtimeGateway = null;
}
