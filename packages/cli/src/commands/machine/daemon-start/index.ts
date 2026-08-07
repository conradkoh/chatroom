/**
 * Daemon Start Command — entry point.
 *
 * Re-exports the public API for the daemon-start module:
 * - daemonStart: the main entry point
 * - Handler functions and types for testing
 */

import { startDaemon } from '../../../daemon/entry/start-daemon.js';

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Start the daemon: initialize, then enter the command processing loop.
 */
export async function daemonStart(): Promise<void> {
  await startDaemon();
}

// ─── Re-exports for Testing ─────────────────────────────────────────────────

export type {
  CommandResult,
  StartAgentCommand,
  StopAgentCommand,
  MachineCommand,
} from '../../../daemon/entry/daemon-types.js';

export type {
  DaemonDeps,
  StartAgentDeps,
  StopAgentDeps,
  StateRecoveryDeps,
  MachineStateOps,
} from '../../../daemon/entry/daemon-deps.js';
