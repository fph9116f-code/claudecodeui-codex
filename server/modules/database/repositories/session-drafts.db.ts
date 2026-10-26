import { getConnection } from '@/modules/database/connection.js';

/**
 * One chat scope's unsent composer text.
 *
 * Queued messages used to live here too; they now have their own table
 * (`chat_queue_messages`) so saving the composer can never create, restore or
 * clear one. The legacy `queued_message` column is only read by the one-time
 * migration in `migrations.ts`.
 */
export type SessionDraftRecord = {
  scope: string;
  text: string;
  updatedAt: string;
};

type DraftRow = {
  draft_scope: string;
  draft_text: string;
  updated_at: string;
};

export const sessionDraftsDb = {
  /**
   * Returns every draft the user has, newest first.
   *
   * The client pulls the whole set once per load: drafts are short strings, and
   * having them all up front means switching sessions restores a draft written
   * on another device without a round trip.
   */
  getDrafts(userId: number): SessionDraftRecord[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT draft_scope, draft_text, updated_at
         FROM session_drafts
         WHERE user_id = ?
         ORDER BY datetime(updated_at) DESC`
      )
      .all(userId) as DraftRow[];

    return rows.map((row) => ({
      scope: row.draft_scope,
      text: row.draft_text,
      updatedAt: row.updated_at,
    }));
  },

  /**
   * Writes one scope's draft, or deletes the row when the text is empty.
   *
   * Deleting on empty is what stops the table growing a permanent row for every
   * session the user ever opened and typed a character into.
   */
  saveDraft(userId: number, scope: string, draft: { text: string }): void {
    const db = getConnection();

    if (!draft.text) {
      db.prepare('DELETE FROM session_drafts WHERE user_id = ? AND draft_scope = ?')
        .run(userId, scope);
      return;
    }

    db.prepare(
      `INSERT INTO session_drafts (user_id, draft_scope, draft_text, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, draft_scope) DO UPDATE SET
         draft_text = excluded.draft_text,
         updated_at = CURRENT_TIMESTAMP`
    ).run(userId, scope, draft.text);
  },

  deleteDraft(userId: number, scope: string): void {
    getConnection()
      .prepare('DELETE FROM session_drafts WHERE user_id = ? AND draft_scope = ?')
      .run(userId, scope);
  },
};
