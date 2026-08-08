// fallow-ignore-file unused-file
import type { DatabaseSync } from 'node:sqlite';

export type ParticipantReadModelRow = {
  chatroomId: string;
  role: string;
  turnPhase?: string;
  lastSeenAt?: number;
  updatedAt: number;
};

export function upsertParticipantReadModel(db: DatabaseSync, row: ParticipantReadModelRow): void {
  db.prepare(
    `INSERT INTO read_model_participants(chatroom_id, role, turn_phase, last_seen_at, updated_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(chatroom_id, role) DO UPDATE SET
       turn_phase = excluded.turn_phase,
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`
  ).run(row.chatroomId, row.role, row.turnPhase ?? null, row.lastSeenAt ?? null, row.updatedAt);
}

export function getParticipantReadModel(
  db: DatabaseSync,
  chatroomId: string,
  role: string
): ParticipantReadModelRow | null {
  const row = db
    .prepare(
      `SELECT chatroom_id as chatroomId, role, turn_phase as turnPhase, last_seen_at as lastSeenAt,
              updated_at as updatedAt
       FROM read_model_participants WHERE chatroom_id = ? AND role = ?`
    )
    .get(chatroomId, role) as
    | {
        chatroomId: string;
        role: string;
        turnPhase: string | null;
        lastSeenAt: number | null;
        updatedAt: number;
      }
    | undefined;
  if (!row) return null;
  return {
    chatroomId: row.chatroomId,
    role: row.role,
    turnPhase: row.turnPhase ?? undefined,
    lastSeenAt: row.lastSeenAt ?? undefined,
    updatedAt: row.updatedAt,
  };
}
