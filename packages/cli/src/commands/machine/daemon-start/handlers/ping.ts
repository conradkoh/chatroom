/**
 * Ping Command Handler — responds with "pong" to verify daemon connectivity.
 */

import type { CommandResult } from '../types.js';

export function handlePing(): CommandResult {
  console.log(`   ↪ Responding: pong`);
  return { result: 'pong', failed: false };
}
