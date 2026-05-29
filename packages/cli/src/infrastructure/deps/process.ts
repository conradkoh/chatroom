/**
 * Process Operations — shared dependency interface for OS process management.
 *
 * Wraps process.kill to decouple command handlers from direct OS interactions.
 * Used by onAgentShutdown and onDaemonShutdown for process-group kills.
 */

import type { Signals } from '../types/signals.js';

export interface ProcessOps {
  /** Send a signal to a process (wraps process.kill) */
  kill: (pid: number, signal?: Signals | number) => void;
}

export type KillFn = ProcessOps['kill'];

/**
 * Returns true if the process identified by `pid` is still alive.
 * Uses signal 0 (no signal sent) — kill throws if the process does not exist.
 */
export function isProcessAlive(kill: KillFn, pid: number): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
