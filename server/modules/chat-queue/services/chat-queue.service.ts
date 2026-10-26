import { chatQueueDb, sessionsDb } from '@/modules/database/index.js';
import type { ChatQueueMessageRecord } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/** Guards against a runaway client queueing the same session forever. */
const MAX_QUEUE_MESSAGES_PER_SESSION = 100;
const MAX_CONTENT_LENGTH = 100_000;
const MAX_ATTACHMENTS = 20;
const MAX_REQUEST_ID_LENGTH = 200;

/** A queued turn as the API and the composer see it. */
export type ChatQueueMessage = {
  id: string;
  sessionId: string;
  position: number;
  content: string;
  options: Record<string, unknown>;
  attachments: unknown[];
  status: 'pending' | 'running' | 'steered' | 'failed' | 'unknown';
  version: number;
  attempts: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One session's queue plus the reason it is paused, if it is. */
export type ChatQueueSnapshot = {
  messages: ChatQueueMessage[];
  paused: boolean;
  pauseReason: string | null;
};

/** Called by the App composition root to start a drain without coupling this module to the runtime. */
export type ChatQueueDrainTrigger = (sessionId: string) => void;

let drainTrigger: ChatQueueDrainTrigger | null = null;

/**
 * Registers the dispatcher's per-session drain. The Chat Queue dispatcher
 * installs it at startup; without it, appends are still persisted and the
 * recovery poll picks them up.
 */
export function setChatQueueDrainTrigger(trigger: ChatQueueDrainTrigger | null): void {
  drainTrigger = trigger;
}

/** Nudges the dispatcher after a queue change; storage stays authoritative. */
function notifyQueueChanged(sessionId: string): void {
  try {
    drainTrigger?.(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ChatQueue] Drain trigger failed', { sessionId, error: message });
  }
}

function readOptions(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('options must be an object.', {
      code: 'INVALID_QUEUE_OPTIONS',
      statusCode: 400,
    });
  }
  return value as Record<string, unknown>;
}

function readAttachments(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AppError('attachments must be an array.', {
      code: 'INVALID_QUEUE_ATTACHMENTS',
      statusCode: 400,
    });
  }
  if (value.length > MAX_ATTACHMENTS) {
    throw new AppError(`A queued message can carry at most ${MAX_ATTACHMENTS} attachments.`, {
      code: 'TOO_MANY_QUEUE_ATTACHMENTS',
      statusCode: 400,
    });
  }
  for (const attachment of value) {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      throw new AppError('Each attachment must be an uploaded-file descriptor.', {
        code: 'INVALID_QUEUE_ATTACHMENTS',
        statusCode: 400,
      });
    }
  }
  return value;
}

function readContent(value: unknown, attachments: unknown[]): string {
  if (value === undefined || value === null) {
    value = '';
  }
  if (typeof value !== 'string') {
    throw new AppError('content must be a string.', {
      code: 'INVALID_QUEUE_CONTENT',
      statusCode: 400,
    });
  }
  if (value.length > MAX_CONTENT_LENGTH) {
    throw new AppError('That message is too long to queue.', {
      code: 'QUEUE_CONTENT_TOO_LONG',
      statusCode: 413,
    });
  }
  if (!value.trim() && attachments.length === 0) {
    throw new AppError('A queued message needs some text or an attachment.', {
      code: 'QUEUE_CONTENT_REQUIRED',
      statusCode: 400,
    });
  }
  return value;
}

function readRequestId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('requestId must be a non-empty string when provided.', {
      code: 'INVALID_QUEUE_REQUEST_ID',
      statusCode: 400,
    });
  }
  if (value.length > MAX_REQUEST_ID_LENGTH) {
    throw new AppError('requestId is too long.', {
      code: 'INVALID_QUEUE_REQUEST_ID',
      statusCode: 400,
    });
  }
  return value;
}

function readSessionId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('sessionId is required.', {
      code: 'SESSION_ID_REQUIRED',
      statusCode: 400,
    });
  }
  const sessionId = value.trim();
  if (!sessionsDb.getSessionById(sessionId)) {
    throw new AppError(`Session "${sessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }
  return sessionId;
}

/**
 * Maps a stored row to the API shape. Used by the Chat Queue routes and its
 * dispatcher, which needs the same parsed options and attachments the composer
 * queued.
 */
export function toChatQueueMessage(record: ChatQueueMessageRecord): ChatQueueMessage {
  let options: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(record.options);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      options = parsed as Record<string, unknown>;
    }
  } catch {
    // A corrupt options blob must not hide the message itself.
  }

  let attachments: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(record.attachments);
    if (Array.isArray(parsed)) {
      attachments = parsed;
    }
  } catch {
    // Same: the text can still be sent without its attachments.
  }

  return {
    id: record.id,
    sessionId: record.session_id,
    position: record.position,
    content: record.content,
    options,
    attachments,
    // `skipped` rows are never returned by the repository's visible query.
    status: record.status as ChatQueueMessage['status'],
    version: record.version,
    attempts: record.attempts,
    failureReason: record.failure_reason,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function assertSessionExists(sessionId: string): void {
  if (!sessionsDb.getSessionById(sessionId)) {
    throw new AppError(`Session "${sessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }
}

function toMutationError(result: 'not-found' | 'not-pending' | 'version-conflict'): AppError {
  switch (result) {
    case 'not-found':
      return new AppError('That queued message no longer exists.', {
        code: 'QUEUE_MESSAGE_NOT_FOUND',
        statusCode: 404,
      });
    case 'version-conflict':
      return new AppError('That queued message changed elsewhere. Refresh and try again.', {
        code: 'QUEUE_MESSAGE_VERSION_CONFLICT',
        statusCode: 409,
      });
    case 'not-pending':
    default:
      return new AppError('That message is already being sent, so it can no longer be changed.', {
        code: 'QUEUE_MESSAGE_NOT_PENDING',
        statusCode: 409,
      });
  }
}

/** Used by the Chat Queue routes; all queue persistence and validation lives here. */
export const chatQueueService = {
  /** One session's visible queue, oldest first, plus its pause state. */
  list(userId: number, sessionId: string): ChatQueueSnapshot {
    assertSessionExists(sessionId);
    const records = chatQueueDb.listForSession(userId, sessionId);
    const failure = records.find((row) => row.status === 'failed' || row.status === 'unknown');
    return {
      messages: records.map(toChatQueueMessage),
      paused: Boolean(failure),
      pauseReason: failure?.failure_reason ?? null,
    };
  },

  /**
   * Queues a message for the session's next turn.
   *
   * `requestId` is the client's idempotency key: submitting twice (a retried
   * request) returns the first row instead of queueing the text twice.
   */
  append(input: {
    userId: number;
    sessionId: unknown;
    requestId?: unknown;
    content?: unknown;
    options?: unknown;
    attachments?: unknown;
  }): ChatQueueMessage {
    const sessionId = readSessionId(input.sessionId);
    const attachments = readAttachments(input.attachments);
    const content = readContent(input.content, attachments);
    const options = readOptions(input.options);
    const requestId = readRequestId(input.requestId);

    if (chatQueueDb.countForSession(input.userId, sessionId) >= MAX_QUEUE_MESSAGES_PER_SESSION) {
      throw new AppError('This session already has too many queued messages.', {
        code: 'QUEUE_FULL',
        statusCode: 429,
      });
    }

    const record = chatQueueDb.append({
      userId: input.userId,
      sessionId,
      content,
      options: JSON.stringify(options),
      attachments: JSON.stringify(attachments),
      requestId,
    });
    notifyQueueChanged(sessionId);
    return toChatQueueMessage(record);
  },

  /** Replaces a pending message. The version is what the editor last read. */
  edit(input: {
    userId: number;
    id: string;
    version: unknown;
    content?: unknown;
    options?: unknown;
    attachments?: unknown;
  }): ChatQueueMessage {
    if (typeof input.version !== 'number' || !Number.isInteger(input.version)) {
      throw new AppError('version is required to edit a queued message.', {
        code: 'QUEUE_VERSION_REQUIRED',
        statusCode: 400,
      });
    }

    const attachments = readAttachments(input.attachments);
    const content = readContent(input.content, attachments);
    const options = readOptions(input.options);

    const result = chatQueueDb.update({
      userId: input.userId,
      id: input.id,
      expectedVersion: input.version,
      content,
      options: JSON.stringify(options),
      attachments: JSON.stringify(attachments),
    });
    if (!result.ok) {
      throw toMutationError(result.reason);
    }

    return toChatQueueMessage(result.record!);
  },

  /** Deletes a pending message. A claimed one is refused: it may already be sending. */
  remove(userId: number, id: string, version?: number): void {
    const result = chatQueueDb.remove(userId, id, version);
    if (!result.ok) {
      throw toMutationError(result.reason);
    }
  },

  /** Explicitly re-runs a failed or uncertain message and resumes the session queue. */
  retry(userId: number, id: string): ChatQueueMessage {
    const result = chatQueueDb.retry(userId, id);
    if (!result.ok) {
      throw toMutationError(result.reason);
    }
    const message = toChatQueueMessage(result.record!);
    notifyQueueChanged(message.sessionId);
    return message;
  },

  /** Continues past a failure without re-running it. */
  skip(userId: number, id: string): void {
    const result = chatQueueDb.skip(userId, id);
    if (!result.ok) {
      throw toMutationError(result.reason);
    }
    const record = result.record!;
    notifyQueueChanged(record.session_id);
  },
};
