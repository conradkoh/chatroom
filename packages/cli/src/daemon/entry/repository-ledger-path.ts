// fallow-ignore-file unused-file
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolves the daemon-local JSON file holding the machine's repository ledger. */
export function resolveRepositoryLedgerPath(machineId: string): string {
  return join(homedir(), '.chatroom', 'daemon', machineId, 'repository-ledger.json');
}
