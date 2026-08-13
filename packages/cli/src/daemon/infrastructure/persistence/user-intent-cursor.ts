import type { DatabaseSync } from 'node:sqlite';
const CURSOR_KEY = 'user-message';
export function loadUserIntentCursor(db: DatabaseSync): string | undefined {
  return (db.prepare('SELECT cursor_value as value FROM user_intent_cursor WHERE key = ?').get(CURSOR_KEY) as { value?: string } | undefined)?.value;
}
export function saveUserIntentCursor(db: DatabaseSync, cursor: string, now: number): void {
  db.prepare('INSERT INTO user_intent_cursor(key, cursor_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET cursor_value=excluded.cursor_value, updated_at=excluded.updated_at').run(CURSOR_KEY, cursor, now);
}
