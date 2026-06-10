// fallow-ignore-file unused-file
/**
 * Status Command Handler — responds with machine info (hostname, OS, harnesses).
 */

import { Effect } from 'effect';

import { DaemonContextService } from '../daemon-context-service.js';
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

/** Effect twin — yields DaemonContextService and delegates to handleStatus */
export const handleStatusEffect: Effect.Effect<CommandResult, never, DaemonContextService> =
  Effect.gen(function* () {
    const ctx = yield* DaemonContextService;
    return handleStatus(ctx);
  });
