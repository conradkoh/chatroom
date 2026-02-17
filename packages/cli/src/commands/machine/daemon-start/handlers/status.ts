/**
 * Status Command Handler — responds with machine info (hostname, OS, harnesses).
 */

import type { CommandResult, DaemonContext } from '../types.js';

export function handleStatus(ctx: DaemonContext): CommandResult {
  const result = JSON.stringify({
    hostname: ctx.config?.hostname,
    os: ctx.config?.os,
    availableHarnesses: ctx.config?.availableHarnesses,
    chatroomAgents: Object.keys(ctx.config?.chatroomAgents ?? {}),
  });
  console.log(`   ↪ Responding with status`);
  return { result, failed: false };
}
