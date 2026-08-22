import { homedir } from 'node:os';
import { join } from 'node:path';

export type OutboxDbKind = 'file-tree-delta' | 'file-tree-checkpoint' | 'agent-lifecycle';
export function resolveOutboxDbPath(machineId: string, kind: OutboxDbKind): string {
  return join(homedir(), '.chatroom', 'daemon', machineId, `outbox-${kind}.sqlite`);
}
