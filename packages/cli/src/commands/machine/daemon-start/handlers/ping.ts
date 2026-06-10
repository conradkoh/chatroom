/**
 * Ping Command Handler — responds with "pong" to verify daemon connectivity.
 */

import { Effect } from 'effect';

import type { CommandResult } from '../types.js';

export function handlePing(): CommandResult {
  console.log(`   ↪ Responding: pong`);
  return { result: 'pong', failed: false };
}

/** Effect twin — pure, no service deps needed */
// fallow-ignore-next-line unused-export
export const handlePingEffect: Effect.Effect<CommandResult> = Effect.sync(handlePing);
