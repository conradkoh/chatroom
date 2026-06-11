/**
 * Daemon Startup Log — logs version, machine ID, and capabilities on daemon start.
 * Extracted from init.ts for Effect migration.
 */
// fallow-ignore-file unused-file

import { Effect } from 'effect';

import type { MachineConfig } from '../../../../infrastructure/machine/types.js';
import { getVersion } from '../../../../version.js';
import { DaemonSessionService } from '../daemon-services.js';
import { formatTimestamp } from '../utils.js';

/** Flat deps for core — no DaemonContext. */
export interface LogStartupDeps {
  machineId: string;
  config: MachineConfig | null;
}

/**
 * Core — logs startup information.
 */
export function logStartupCore(
  deps: LogStartupDeps,
  availableModels: Record<string, string[]>
): void {
  console.log(`[${formatTimestamp()}] 🚀 Daemon started`);
  console.log(`   CLI version: ${getVersion()}`);
  console.log(`   Machine ID: ${deps.machineId}`);
  console.log(`   Hostname: ${deps.config?.hostname ?? 'unknown'}`);
  console.log(`   Available harnesses: ${deps.config?.availableHarnesses.join(', ') || 'none'}`);
  console.log(
    `   Available models: ${Object.keys(availableModels).length > 0 ? `${Object.values(availableModels).flat().length} models across ${Object.keys(availableModels).join(', ')}` : 'none discovered'}`
  );
  console.log(`   PID: ${process.pid}`);
}

/** Effect twin — yields DaemonSessionService. Pure sync log via Effect.sync. */
export const logStartupEffect = (
  availableModels: Record<string, string[]>
): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    yield* Effect.sync(() =>
      logStartupCore({ machineId: session.machineId, config: session.config }, availableModels)
    );
  });
