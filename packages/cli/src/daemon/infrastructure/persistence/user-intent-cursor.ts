import type { DatabaseSync } from 'node:sqlite';

function cursorKey(chatroomId: string): string {
  return `user-message:${chatroomId}`;
}

export function loadUserIntentCursor(db: DatabaseSync, chatroomId: string): string | undefined {
  return (
    db
      .prepare('SELECT cursor_value as value FROM user_intent_cursor WHERE key = ?')
      .get(cursorKey(chatroomId)) as { value?: string } | undefined
  )?.value;
}

export function saveUserIntentCursor(
  db: DatabaseSync,
  chatroomId: string,
  cursor: string,
  now: number
): void {
  db.prepare(
    'INSERT INTO user_intent_cursor(key, cursor_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET cursor_value=excluded.cursor_value, updated_at=excluded.updated_at'
  ).run(cursorKey(chatroomId), cursor, now);
}
