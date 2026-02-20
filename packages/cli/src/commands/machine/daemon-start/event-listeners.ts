/**
 * Event Listeners — registers side-effect handlers on the DaemonEventBus.
 *
 * Consolidates cleanup logic (PID clearing, participant removal, logging)
 * that was previously duplicated across command handlers.
 *
 * Called once at daemon startup after the event bus is created.
 */

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api, type Id } from '../../../api.js';
import { onAgentShutdown } from '../events/on-agent-shutdown/index.js';

/**
 * Register all daemon event listeners.
 * Returns an unsubscribe function that removes all listeners (for tests).
 */
export function registerEventListeners(ctx: DaemonContext): () => void {
  const unsubs: (() => void)[] = [];

  // ── agent:exited ────────────────────────────────────────────────────────
  // When an agent process exits (crash or intentional), clean up all state:
  // 1. Clear PID from backend (updateSpawnedAgent)
  // 2. Clear PID from local machine state
  // 3. Remove participant record (so UI shows offline)
  unsubs.push(
    ctx.events.on('agent:exited', (payload) => {
      const { chatroomId, role, pid, code, signal, intentional } = payload;
      const ts = formatTimestamp();

      if (intentional) {
        console.log(
          `[${ts}] ℹ️  Agent process exited after intentional stop ` +
            `(PID: ${pid}, role: ${role}, code: ${code}, signal: ${signal})`
        );
      } else {
        console.log(
          `[${ts}] ⚠️  Agent process exited ` +
            `(PID: ${pid}, role: ${role}, code: ${code}, signal: ${signal})`
        );
      }

      // Clear PID from backend
      ctx.deps.backend
        .mutation(api.machines.updateSpawnedAgent, {
          sessionId: ctx.sessionId,
          machineId: ctx.machineId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          pid: undefined,
        })
        .catch((err: Error) => {
          console.log(`   ⚠️  Failed to clear PID in backend: ${err.message}`);
        });

      // Clear PID from local state
      ctx.deps.machine.clearAgentPid(ctx.machineId, chatroomId, role);

      // Stop tracking in the remote agent service
      ctx.remoteAgentService.untrack(pid);

      // Remove participant record so the UI reflects the exit
      ctx.deps.backend
        .mutation(api.participants.leave, {
          sessionId: ctx.sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        })
        .catch((err: Error) => {
          console.log(`   ⚠️  Could not remove participant: ${err.message}`);
        });

      // Dual-write: lifecycle table (Phase 4)
      // Intentional stop → offline, crash → dead
      ctx.deps.backend
        .mutation(api.machineAgentLifecycle.transition, {
          sessionId: ctx.sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          targetState: intentional ? 'offline' : 'dead',
        })
        .catch((err: Error) => {
          console.log(`   ⚠️  Lifecycle transition failed: ${err.message}`);
        });
    })
  );

  // ── agent:started ──────────────────────────────────────────────────────
  unsubs.push(
    ctx.events.on('agent:started', (payload) => {
      const ts = formatTimestamp();
      console.log(
        `[${ts}] 🟢 Agent started: ${payload.role} (PID: ${payload.pid}, harness: ${payload.harness})`
      );
    })
  );

  // ── agent:stopped ──────────────────────────────────────────────────────
  unsubs.push(
    ctx.events.on('agent:stopped', (payload) => {
      const ts = formatTimestamp();
      console.log(`[${ts}] 🔴 Agent stopped: ${payload.role} (PID: ${payload.pid})`);
    })
  );

  // ── agent:idle-detected ─────────────────────────────────────────────────
  unsubs.push(
    ctx.events.on('agent:idle-detected', (payload) => {
      const { chatroomId, role, pid } = payload;
      onAgentShutdown(ctx, { chatroomId, role, pid }).catch((e) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Failed to stop idle agent ${role}: ${(e as Error).message}`
        );
      });
    })
  );

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
