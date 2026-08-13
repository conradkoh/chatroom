import type { DatabaseSync } from 'node:sqlite';
export function hasProcessedInboundMessage(db: DatabaseSync, chatroomId: string, messageId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM processed_inbound_messages WHERE chatroom_id = ? AND message_id = ?').get(chatroomId, messageId));
}
export function markInboundMessageProcessed(db: DatabaseSync, chatroomId: string, messageId: string, now: number): void {
  db.prepare('INSERT OR IGNORE INTO processed_inbound_messages(chatroom_id, message_id, processed_at) VALUES (?, ?, ?)').run(chatroomId, messageId, now);
}
