/**
 * Daemon Start Command — entry point.
 *
 * Re-exports the public API for the daemon-start module:
 * - daemonStart: the main entry point
 * - Handler functions and types for testing
 */

import { startCommandLoop } from './command-loop.js';
import { initDaemon } from './init.js';

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Start the daemon: initialize, then enter the command processing loop.
 */
export async function daemonStart(): Promise<void> {
  const ctx = await initDaemon();
  await startCommandLoop(ctx);
}

// ─── Re-exports for Testing ─────────────────────────────────────────────────

export { handleStopAgent } from './handlers/stop-agent.js';
export { recoverAgentState } from './handlers/state-recovery.js';

export type {
  DaemonContext,
  CommandResult,
  StartAgentCommand,
  StopAgentCommand,
  MachineCommand,
} from './types.js';

export type {
  DaemonDeps,
  StartAgentDeps,
  StopAgentDeps,
  StateRecoveryDeps,
  MachineStateOps,
} from './deps.js';
