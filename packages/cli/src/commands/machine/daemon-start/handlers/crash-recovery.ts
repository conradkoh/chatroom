/**
 * Crash Recovery Handler — handles agent process crash recovery with retry logic.
 */

import {
  CRASH_RESTART_DELAY_MS,
  MAX_CRASH_RESTART_ATTEMPTS,
} from '@workspace/backend/config/reliability.js';

import { api, type Id } from '../../../../api.js';
import type { DaemonContext, StartAgentCommand } from '../types.js';
import { formatTimestamp } from '../utils.js';
import { clearAgentPidEverywhere } from './shared.js';
import { handleStartAgent } from './start-agent.js';

/**
 * Handle agent process crash recovery.
 * Called when an agent process exits unexpectedly. Performs:
 * 1. Clear PID from backend and local state
 * 2. Mark agent as offline (participants.leave) so tasks can be recovered
 * 3. Auto-restart the agent with retry logic (up to MAX_CRASH_RESTART_ATTEMPTS)
 *
 * If restart fails after MAX_CRASH_RESTART_ATTEMPTS, logs a warning and stops.
 */
export async function handleAgentCrashRecovery(
  ctx: DaemonContext,
  originalCommand: StartAgentCommand
): Promise<void> {
  const { chatroomId, role } = originalCommand.payload;
  const ts = formatTimestamp();

  // Step 1: Clear PID from backend and local state
  await clearAgentPidEverywhere(ctx, chatroomId, role).catch((err) => {
    console.log(`   ⚠️  Failed to clear PID after exit: ${(err as Error).message}`);
  });

  // Step 2: Mark agent as offline so tasks are recoverable
  // NOTE: This deletes the participant record. There is a brief window between
  // this deletion and the updateAgentStatus('restarting') call below where the
  // participant doesn't exist. This is acceptable because:
  // 1. The cleanup cron runs every 2 minutes — unlikely to hit this ~ms window
  // 2. Even if it does, there's nothing to clean up (record doesn't exist)
  // 3. The updateAgentStatus call creates a new minimal record with 'restarting'
  //    status, which the FSM cleanup handles after STALE_FSM_RECORD_TTL_MS (10 min)
  //    if the restart fails silently
  try {
    await ctx.deps.backend.mutation(api.participants.leave, {
      sessionId: ctx.sessionId,
      chatroomId,
      role,
    });
    console.log(`[${ts}]    Marked ${role} as offline (participant removed)`);
  } catch (leaveErr) {
    // Non-critical: participant will eventually expire via readyUntil/activeUntil
    console.log(`[${ts}]    ⚠️  Could not remove participant: ${(leaveErr as Error).message}`);
  }

  // Step 2b: Report FSM status as "restarting" (Plan 026)
  // Since leave() deletes the participant, updateAgentStatus will create a minimal
  // participant record to hold the "restarting" status (dead-state fallback in Phase 4).
  // This record has no readyUntil/activeUntil, so the stale-expiration logic won't
  // catch it — the FSM cleanup (STALE_FSM_RECORD_TTL_MS) handles it instead.
  try {
    await ctx.deps.backend.mutation(api.participants.updateAgentStatus, {
      sessionId: ctx.sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      status: 'restarting' as const,
    });
    console.log(`[${ts}]    Set ${role} status to "restarting"`);
  } catch (statusErr) {
    // Non-critical: UI will show stale status until agent rejoins or cleanup runs
    console.warn(
      `[${ts}]    ⚠️  Could not set agentStatus to restarting: ${(statusErr as Error).message}`
    );
  }

  // Step 3: Auto-restart with retry logic
  console.log(
    `[${ts}] 🔄 Attempting to restart ${role} (max ${MAX_CRASH_RESTART_ATTEMPTS} attempts)...`
  );

  for (let attempt = 1; attempt <= MAX_CRASH_RESTART_ATTEMPTS; attempt++) {
    const attemptTs = formatTimestamp();
    console.log(`[${attemptTs}]    Restart attempt ${attempt}/${MAX_CRASH_RESTART_ATTEMPTS}...`);

    // Wait before restart to avoid tight restart loops
    await ctx.deps.clock.delay(CRASH_RESTART_DELAY_MS);

    try {
      const result = await handleStartAgent(ctx, originalCommand);
      if (!result.failed) {
        const successTs = formatTimestamp();
        console.log(`[${successTs}] ✅ ${role} restarted successfully on attempt ${attempt}`);
        return;
      }
      console.log(`[${attemptTs}]    ⚠️  Restart attempt ${attempt} failed: ${result.result}`);
    } catch (restartErr) {
      console.log(
        `[${attemptTs}]    ⚠️  Restart attempt ${attempt} error: ${(restartErr as Error).message}`
      );
    }
  }

  // All attempts exhausted — report failure to backend (Plan 026)
  const failTs = formatTimestamp();
  console.log(
    `[${failTs}] ❌ Failed to restart ${role} after ${MAX_CRASH_RESTART_ATTEMPTS} attempts. ` +
      `The agent will need to be restarted manually or via the webapp.`
  );

  try {
    await ctx.deps.backend.mutation(api.participants.updateAgentStatus, {
      sessionId: ctx.sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      status: 'dead_failed_revive' as const,
    });
    console.log(`[${failTs}]    Set ${role} status to "dead_failed_revive"`);
  } catch (statusErr) {
    // Non-critical: UI will show "restarting" until cleanup cron runs
    console.warn(
      `[${failTs}]    ⚠️  Could not set agentStatus to dead_failed_revive: ${(statusErr as Error).message}`
    );
  }
}
