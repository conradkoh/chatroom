// fallow-ignore-file unused-file
import type { DatabaseSync } from 'node:sqlite';

export type HandoffReadModelRow = {
  chatroomId: string;
  pendingNextRole?: string;
  messageId?: string;
  updatedAt: number;
};

export function upsertHandoffReadModel(db: DatabaseSync, row: HandoffReadModelRow): void {
  db.prepare(
    `INSERT INTO read_model_handoffs(chatroom_id, pending_next_role, message_id, updated_at)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(chatroom_id) DO UPDATE SET
       pending_next_role = excluded.pending_next_role,
       message_id = excluded.message_id,
       updated_at = excluded.updated_at`
  ).run(row.chatroomId, row.pendingNextRole ?? null, row.messageId ?? null, row.updatedAt);
}

export function getHandoffReadModel(
  db: DatabaseSync,
  chatroomId: string
): HandoffReadModelRow | null {
  const row = db
    .prepare(
      `SELECT chatroom_id as chatroomId, pending_next_role as pendingNextRole, message_id as messageId,
              updated_at as updatedAt
       FROM read_model_handoffs WHERE chatroom_id = ?`
    )
    .get(chatroomId) as
    | {
        chatroomId: string;
        pendingNextRole: string | null;
        messageId: string | null;
        updatedAt: number;
      }
    | undefined;
  if (!row) return null;
  return {
    chatroomId: row.chatroomId,
    pendingNextRole: row.pendingNextRole ?? undefined,
    messageId: row.messageId ?? undefined,
    updatedAt: row.updatedAt,
  };
}
