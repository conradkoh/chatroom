import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolves the daemon-local SQLite database for latest task handoffs. */
export function resolveTaskHandoffRepositoryPath(machineId: string): string {
  return join(homedir(), '.chatroom', 'daemon', machineId, 'task-handoffs.sqlite');
}
