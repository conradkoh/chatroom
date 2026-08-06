import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolvePersistenceDbPath(machineId: string): string {
  return join(homedir(), '.chatroom', 'daemon', machineId, 'events.sqlite');
}
