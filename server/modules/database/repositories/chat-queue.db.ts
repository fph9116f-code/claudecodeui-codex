import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

/**
 * One queued chat message and the state it has reached.
 *
 * - `pending`   waiting for the session to become idle (and for any backoff)
 * - `running`   claimed by the dispatcher; the provider run is in flight
 * - `steering`  claimed for "insert now", before the runtime accepted it
 * - `steered`   pushed into the live turn; awaiting a steer outcome
 * - `delivered` the message reached the provider; kept as the request-id receipt
 * - `failed`    the runtime accepted the message and then failed; never replayed
 * - `unknown`   the outcome could not be confirmed; never replayed
 * - `skipped`   the user chose to continue past a failure; kept for the record
 *
 * Any `failed` or `unknown` row pauses the session queue until the user
 * retries that message or skips it: a turn that may already have produced
 * side effects must not be replayed automatically.
 */
export type ChatQueueMessageStatus =
  | 'pending'
  | 'running'
  | 'steering'
  | 'steered'
  | 'delivered'
  | 'failed'
  | 'unknown'
  | 'skipped';

/** A persisted chat-queue row, with its JSON columns still unparsed. */
export type ChatQueueMessageRecord = {
  id: string;
  user_id: number;
  session_id: string;
  position: number;
  content: string;
  options: string;
  attachments: string;
  status: ChatQueueMessageStatus;
  version: number;
  attempts: number;
  failure_reason: string | null;
  request_id: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  run_id: string | null;
};

/** The outcome of an edit or delete that has to present the version it read. */
export type ChatQueueMutationResult =
  | { ok: true; record: ChatQueueMessageRecord | null }
  | { ok: false; reason: 'not-found' | 'not-pending' | 'version-conflict' };

type ChatQueueRow = {
  id: string;
  user_id: number;
  session_id: string;
  position: number;
  content: string;
  options: string;
  attachments: string;
  status: ChatQueueMessageStatus;
  version: number;
  attempts: number;
  failure_reason: string | null;
  request_id: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  run_id: string | null;
};

const COLUMNS = `id, user_id, session_id, position, content, options, attachments, status,
  version, attempts, failure_reason, request_id, next_attempt_at, created_at, updated_at,
  claimed_at, run_id`;

function toRecord(row: ChatQueueRow): ChatQueueMessageRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    session_id: row.session_id,
    position: row.position,
    content: row.content,
    options: row.options,
    attachments: row.attachments,
    status: row.status,
    version: row.version,
    attempts: row.attempts,
    failure_reason: row.failure_reason,
    request_id: row.request_id,
    next_attempt_at: row.next_attempt_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
    run_id: row.run_id,
  };
}

/** Queue rows the composer shows: waiting, in flight, steered, and the failures that pause it. */
const VISIBLE_STATUSES = "('pending', 'running', 'steering', 'steered', 'failed', 'unknown')";

export const chatQueueDb = {
  /** Every visible message for one session, oldest first. */
  listForSession(userId: number, sessionId: string): ChatQueueMessageRecord[] {
    const rows = getConnection()
      .prepare(
        `SELECT ${COLUMNS}
         FROM chat_queue_messages
         WHERE user_id = ? AND session_id = ? AND status IN ${VISIBLE_STATUSES}
         ORDER BY position ASC`
      )
      .all(userId, sessionId) as ChatQueueRow[];
    return rows.map(toRecord);
  },

  /** Sessions with something to send, for the recovery scan. */
  listSessionsWithPending(): Array<{ user_id: number; session_id: string }> {
    return getConnection()
      .prepare(
        `SELECT DISTINCT user_id, session_id
         FROM chat_queue_messages
         WHERE status = 'pending'`
      )
      .all() as Array<{ user_id: number; session_id: string }>;
  },

  /** The owner of a pending row, or null when the session has nothing to send. */
  findPendingOwner(sessionId: string): number | null {
    const row = getConnection()
      .prepare(
        `SELECT user_id
         FROM chat_queue_messages
         WHERE session_id = ? AND status = 'pending'
         LIMIT 1`
      )
      .get(sessionId) as { user_id: number } | undefined;
    return row?.user_id ?? null;
  },

  findById(userId: number, id: string): ChatQueueMessageRecord | null {
    const row = getConnection()
      .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE user_id = ? AND id = ?`)
      .get(userId, id) as ChatQueueRow | undefined;
    return row ? toRecord(row) : null;
  },

  countForSession(userId: number, sessionId: string): number {
    const row = getConnection()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM chat_queue_messages
         WHERE user_id = ? AND session_id = ?
           AND status IN ('pending', 'running', 'failed', 'unknown')`
      )
      .get(userId, sessionId) as { count: number };
    return row.count;
  },

  /**
   * Appends one message to the end of a session's queue.
   *
   * A repeated `requestId` returns the row created the first time, so a
   * network retry of the same submit cannot queue the text twice. The position
   * is allocated inside the transaction so two appends cannot share one.
   */
  append(input: {
    userId: number;
    sessionId: string;
    content: string;
    options: string;
    attachments: string;
    requestId: string | null;
  }): ChatQueueMessageRecord {
    const db = getConnection();

    const insert = (): ChatQueueMessageRecord => {
      if (input.requestId) {
        const existing = db
          .prepare(
            `SELECT ${COLUMNS} FROM chat_queue_messages
             WHERE user_id = ? AND request_id = ?`
          )
          .get(input.userId, input.requestId) as ChatQueueRow | undefined;
        if (existing) {
          return toRecord(existing);
        }
      }

      const { position } = db
        .prepare(
          `SELECT COALESCE(MAX(position), 0) + 1 AS position
           FROM chat_queue_messages
           WHERE user_id = ? AND session_id = ?`
        )
        .get(input.userId, input.sessionId) as { position: number };
      const id = randomUUID();

      db.prepare(
        `INSERT INTO chat_queue_messages
           (id, user_id, session_id, position, content, options, attachments, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        input.userId,
        input.sessionId,
        position,
        input.content,
        input.options,
        input.attachments,
        input.requestId
      );

      const row = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE id = ?`)
        .get(id) as ChatQueueRow;
      return toRecord(row);
    };

    return db.transaction(insert)();
  },

  /**
   * Replaces a still-pending message's body if the caller saw its current
   * version. A claimed message is no longer editable: the run may already be
   * using the old text.
   */
  update(input: {
    userId: number;
    id: string;
    expectedVersion: number;
    content: string;
    options: string;
    attachments: string;
  }): ChatQueueMutationResult {
    const db = getConnection();

    return db.transaction((): ChatQueueMutationResult => {
      const current = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE user_id = ? AND id = ?`)
        .get(input.userId, input.id) as ChatQueueRow | undefined;
      if (!current) {
        return { ok: false, reason: 'not-found' };
      }
      if (current.status !== 'pending') {
        return { ok: false, reason: 'not-pending' };
      }
      if (current.version !== input.expectedVersion) {
        return { ok: false, reason: 'version-conflict' };
      }

      db.prepare(
        `UPDATE chat_queue_messages
         SET content = ?, options = ?, attachments = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND id = ?`
      ).run(input.content, input.options, input.attachments, input.userId, input.id);

      const row = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE user_id = ? AND id = ?`)
        .get(input.userId, input.id) as ChatQueueRow;
      return { ok: true, record: toRecord(row) };
    })();
  },

  /** Removes a pending message; refuses once the dispatcher has claimed it. */
  remove(userId: number, id: string, expectedVersion?: number): ChatQueueMutationResult {
    const db = getConnection();

    return db.transaction((): ChatQueueMutationResult => {
      const current = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE user_id = ? AND id = ?`)
        .get(userId, id) as ChatQueueRow | undefined;
      if (!current) {
        return { ok: false, reason: 'not-found' };
      }
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        return { ok: false, reason: 'version-conflict' };
      }
      if (current.status !== 'pending') {
        return { ok: false, reason: 'not-pending' };
      }

      db.prepare('DELETE FROM chat_queue_messages WHERE user_id = ? AND id = ?').run(userId, id);
      return { ok: true, record: null };
    })();
  },

  /**
   * Claims the next due pending message for a session.
   *
   * The status check makes the claim atomic: a second dispatcher (or a second
   * process) gets nothing rather than sending the same message twice.
   */
  claimNext(userId: number, sessionId: string, runId: string): ChatQueueMessageRecord | null {
    const db = getConnection();

    return db.transaction((): ChatQueueMessageRecord | null => {
      // The head of the queue decides: if it is still inside its retry
      // backoff, the whole session waits. Filtering by `next_attempt_at`
      // before ordering would let a later message overtake it and run without
      // the result the user was waiting for.
      const next = db
        .prepare(
          `SELECT ${COLUMNS}
           FROM chat_queue_messages
           WHERE user_id = ? AND session_id = ? AND status = 'pending'
           ORDER BY position ASC
           LIMIT 1`
        )
        .get(userId, sessionId) as ChatQueueRow | undefined;
      if (!next) {
        return null;
      }
      if (next.next_attempt_at) {
        const { due } = db
          .prepare("SELECT datetime(?) <= datetime('now') AS due")
          .get(next.next_attempt_at) as { due: number };
        if (!due) {
          return null;
        }
      }

      const result = db.prepare(
        `UPDATE chat_queue_messages
         SET status = 'running', attempts = attempts + 1, claimed_at = CURRENT_TIMESTAMP,
             run_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`
      ).run(runId, next.id);
      if (result.changes === 0) {
        return null;
      }

      const row = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE id = ?`)
        .get(next.id) as ChatQueueRow;
      return toRecord(row);
    })();
  },

  /** Puts a not-yet-accepted message back with a retry delay. */
  reschedule(id: string, reason: string, nextAttemptAt: Date): void {
    getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = 'pending', failure_reason = ?, next_attempt_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'running'`
      )
      .run(reason, nextAttemptAt.toISOString(), id);
  },

  /**
   * Stops the message for good. Used both for a run that was accepted and then
   * failed, and for a start failure that exhausted its retries: replaying
   * either could repeat tool side effects.
   */
  markFailed(id: string, reason: string, status: 'failed' | 'unknown' = 'failed'): void {
    getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = ?, failure_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('pending', 'running')`
      )
      .run(status, reason, id);
  },

  /**
   * Keeps a delivered message as the request-id receipt, so a retried submit
   * cannot queue and execute the same instruction again. Hidden from the
   * composer, which only lists the visible statuses.
   */
  markDelivered(id: string): void {
    getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = 'delivered', failure_reason = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'running'`
      )
      .run(id);
  },

  /**
   * Atomically reserves a pending message for "insert now".
   *
   * Only the request that wins this transition may touch the runtime. Doing
   * the injection first (and checking the status afterwards) let two quick
   * clicks inject the same text twice before one of them lost the race.
   */
  claimForInsert(id: string): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = 'steering', claimed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`
      )
      .run(id);
    return result.changes > 0;
  },

  /** The runtime refused the message, so it goes back to waiting (not a failure). */
  revertSteering(id: string, reason: string): void {
    getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = 'pending', failure_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'steering'`
      )
      .run(reason, id);
  },

  /** The runtime accepted the reserved message and it is now in the live turn. */
  markSteered(id: string): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = 'steered', failure_reason = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'steering'`
      )
      .run(id);
    return result.changes > 0;
  },

  /**
   * Every message inserted into a process is acknowledged by that process's
   * next completed turn. Kept as a delivery receipt rather than deleted.
   */
  markSteeredDeliveredForSession(sessionId: string): void {
    getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = 'delivered', failure_reason = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND status IN ('steering', 'steered')`
      )
      .run(sessionId);
  },

  /** A steered message's turn failed or its outcome could not be confirmed. */
  markSteeredFailedForSession(
    sessionId: string,
    reason: string,
    status: 'failed' | 'unknown' = 'failed',
  ): void {
    getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = ?, failure_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND status IN ('steering', 'steered')`
      )
      .run(status, reason, sessionId);
  },

  /** Settles one reserved message whose injection threw before we could tell. */
  markSteeredOutcome(
    id: string,
    reason: string,
    status: 'failed' | 'unknown' = 'unknown',
  ): void {
    getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = ?, failure_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('steering', 'steered')`
      )
      .run(status, reason, id);
  },

  /** Whether a failed or uncertain turn is blocking this session's queue. */
  hasBlockingFailure(userId: number, sessionId: string): boolean {
    const row = getConnection()
      .prepare(
        `SELECT 1 AS blocked
         FROM chat_queue_messages
         WHERE user_id = ? AND session_id = ? AND status IN ('failed', 'unknown')
         LIMIT 1`
      )
      .get(userId, sessionId) as { blocked: number } | undefined;
    return Boolean(row);
  },

  /** What the composer shows as the reason the session's queue is paused. */
  blockingFailureReason(userId: number, sessionId: string): string | null {
    const row = getConnection()
      .prepare(
        `SELECT failure_reason
         FROM chat_queue_messages
         WHERE user_id = ? AND session_id = ? AND status IN ('failed', 'unknown')
         ORDER BY position ASC
         LIMIT 1`
      )
      .get(userId, sessionId) as { failure_reason: string | null } | undefined;
    return row?.failure_reason ?? null;
  },

  /**
   * Turns a failed or uncertain message back into a pending one.
   *
   * Only the user may do this: it is the explicit "run it again" decision the
   * dispatcher is not allowed to make on its own.
   */
  retry(userId: number, id: string): ChatQueueMutationResult {
    const db = getConnection();

    return db.transaction((): ChatQueueMutationResult => {
      const current = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE user_id = ? AND id = ?`)
        .get(userId, id) as ChatQueueRow | undefined;
      if (!current) {
        return { ok: false, reason: 'not-found' };
      }
      if (current.status !== 'failed' && current.status !== 'unknown') {
        return { ok: false, reason: 'not-pending' };
      }

      db.prepare(
        `UPDATE chat_queue_messages
         SET status = 'pending', attempts = 0, failure_reason = NULL,
             next_attempt_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND id = ?`
      ).run(userId, id);

      const row = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE user_id = ? AND id = ?`)
        .get(userId, id) as ChatQueueRow;
      return { ok: true, record: toRecord(row) };
    })();
  },

  /** Lets the rest of the queue continue past a failure the user does not want to retry. */
  skip(userId: number, id: string): ChatQueueMutationResult {
    const db = getConnection();

    return db.transaction((): ChatQueueMutationResult => {
      const current = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE user_id = ? AND id = ?`)
        .get(userId, id) as ChatQueueRow | undefined;
      if (!current) {
        return { ok: false, reason: 'not-found' };
      }
      if (current.status !== 'failed' && current.status !== 'unknown') {
        return { ok: false, reason: 'not-pending' };
      }

      db.prepare(
        `UPDATE chat_queue_messages
         SET status = 'skipped', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND id = ?`
      ).run(userId, id);

      const row = db
        .prepare(`SELECT ${COLUMNS} FROM chat_queue_messages WHERE user_id = ? AND id = ?`)
        .get(userId, id) as ChatQueueRow;
      return { ok: true, record: toRecord(row) };
    })();
  },

  /**
   * Recovers messages a previous server process left mid-dispatch.
   *
   * Their outcome is unknowable — the process may have died before or after
   * the provider accepted the turn — so they become `unknown` and pause the
   * queue rather than being sent again. Steered messages are included: the
   * turn they were inserted into died with the process.
   */
  markInterruptedAsUnknown(reason: string): number {
    const result = getConnection()
      .prepare(
        `UPDATE chat_queue_messages
         SET status = 'unknown', failure_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('running', 'steering', 'steered')`
      )
      .run(reason);
    return result.changes;
  },
};
