import type { DatabaseSync } from 'node:sqlite';
export function hasProcessedInboundMessage(db: DatabaseSync, chatroomId: string, messageId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM processed_inbound_messages WHERE chatroom_id = ? AND message_id = ?').get(chatroomId, messageId));
}
export function getProcessedInboundTaskId(db: DatabaseSync, chatroomId: string, messageId: string): string | undefined {
  return (db.prepare('SELECT task_id as taskId FROM processed_inbound_messages WHERE chatroom_id = ? AND message_id = ?').get(chatroomId, messageId) as { taskId?: string } | undefined)?.taskId;
}
export function markInboundMessageProcessed(db: DatabaseSync, chatroomId: string, messageId: string, taskId: string, now: number): void {
  db.prepare('INSERT OR IGNORE INTO processed_inbound_messages(chatroom_id, message_id, task_id, processed_at) VALUES (?, ?, ?, ?)').run(chatroomId, messageId, taskId, now);
}
