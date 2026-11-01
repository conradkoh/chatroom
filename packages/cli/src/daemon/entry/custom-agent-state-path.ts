/**
 * Path of the daemon's per-machine custom-agent state file.
 *
 * Sits beside the daemon persistence db, so all machine-local daemon state for a
 * machine lives under `~/.chatroom/daemon/<machineId>/`.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** `{ version: 1, disabled: string[] }` for the machine's custom agents. */
export function resolveCustomAgentDisabledStatePath(machineId: string): string {
  return join(homedir(), '.chatroom', 'daemon', machineId, 'custom-agents-disabled.json');
}
