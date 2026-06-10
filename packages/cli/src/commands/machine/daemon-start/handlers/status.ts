// fallow-ignore-file unused-file
/**
 * Status Command Handler — responds with machine info (hostname, OS, harnesses).
 */

import { Effect } from 'effect';

import { DaemonSessionService } from '../daemon-services.js';
import type { CommandResult, DaemonContext } from '../types.js';

export function handleStatus(ctx: DaemonContext): CommandResult {
  const result = JSON.stringify({
    hostname: ctx.config?.hostname,
    os: ctx.config?.os,
    availableHarnesses: ctx.config?.availableHarnesses,
  });
  console.log(`   ↪ Responding with status`);
  return { result, failed: false };
}

/** Effect twin — yields DaemonSessionService; inline logic, no DaemonContextService. */
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
