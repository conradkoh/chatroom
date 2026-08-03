import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Per-machine SQLite event store path under ~/.chatroom/events/.
 * Matches the daemon's other local state layout (see auth/storage.ts).
 */
export function getEventStorePath(machineId: string): string {
  return join(homedir(), '.chatroom', 'events', `${machineId}.sqlite`);
}
