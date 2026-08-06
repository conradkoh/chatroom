/**
 * Status Command Handler — responds with machine info (hostname, OS, harnesses).
 */
// fallow-ignore-file unused-file

import { Effect } from 'effect';

import { DaemonSessionService } from '../../../commands/machine/daemon-start/daemon-services.js';
import type { CommandResult } from '../../../commands/machine/daemon-start/types.js';

/** Effect twin — yields DaemonSessionService. */
export const handleStatusEffect: Effect.Effect<CommandResult, never, DaemonSessionService> =
  Effect.gen(function* () {
    const { config } = yield* DaemonSessionService;
    const result = JSON.stringify({
      hostname: config?.hostname,
      os: config?.os,
      availableHarnesses: config?.availableHarnesses,
    });
    console.log(`   ↪ Responding with status`);
    return { result, failed: false };
  });
