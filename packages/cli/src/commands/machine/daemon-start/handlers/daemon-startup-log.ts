/**
 * Daemon Startup Log — logs version, machine ID, and capabilities on daemon start.
 */

import { Effect } from 'effect';

import { getVersion } from '../../../../version.js';
import { DaemonSessionService } from '../daemon-services.js';
import { formatTimestamp } from '../utils.js';

export const logStartupEffect = (
  availableModels: Record<string, string[]>
): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    // fallow-ignore-next-line complexity
    yield* Effect.sync(() => {
      console.log(`[${formatTimestamp()}] 🚀 Daemon started`);
      console.log(`   CLI version: ${getVersion()}`);
      console.log(`   Machine ID: ${session.machineId}`);
      console.log(`   Hostname: ${session.config?.hostname ?? 'unknown'}`);
      console.log(
        `   Available harnesses: ${session.config?.availableHarnesses.join(', ') || 'none'}`
      );
      console.log(
        `   Available models: ${Object.keys(availableModels).length > 0 ? `${Object.values(availableModels).flat().length} models across ${Object.keys(availableModels).join(', ')}` : 'none discovered'}`
      );
      console.log(`   PID: ${process.pid}`);
    });
  });
