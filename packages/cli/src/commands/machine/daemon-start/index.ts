/**
 * Daemon Start Command — entry point.
 *
 * Re-exports the public API for the daemon-start module:
 * - daemonStart: the main entry point
 * - Handler functions and types for testing
 */

import { Effect } from 'effect';

import { startCommandLoopEffect } from './command-loop.js';
import { daemonSessionToLayers } from './daemon-layers.js';
import { initDaemon } from './init.js';
import { startBackgroundModelDiscoveryEffect } from './models-refresh.js';

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Start the daemon: initialize, then enter the command processing loop.
 */
export async function daemonStart(): Promise<void> {
  const init = await initDaemon();
  const layers = daemonSessionToLayers(init);
  Effect.runFork(startBackgroundModelDiscoveryEffect.pipe(Effect.provide(layers)));
  await Effect.runPromise(startCommandLoopEffect.pipe(Effect.provide(layers)));
}

// ─── Re-exports for Testing ─────────────────────────────────────────────────

export type {
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
