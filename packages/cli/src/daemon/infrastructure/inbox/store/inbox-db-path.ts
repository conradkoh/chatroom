import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolves the dedicated SQLite database shared by all daemon inboxes. */
export function resolveInboxDbPath(machineId: string): string {
  return join(homedir(), '.chatroom', 'daemon', machineId, 'inboxes.sqlite');
}
