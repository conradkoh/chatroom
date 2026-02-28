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

      // Record agent exit event and clear state atomically via recordAgentExited
      ctx.deps.backend
        .mutation(api.machines.recordAgentExited, {
          sessionId: ctx.sessionId,
          machineId: ctx.machineId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          pid,
          intentional,
          exitCode: code ?? undefined,
          signal: signal ?? undefined,
        })
        .catch((err: Error) => {
          console.log(`   ⚠️  Failed to record agent exit event: ${err.message}`);
        });

      // Clear PID from local state
      ctx.deps.machine.clearAgentPid(ctx.machineId, chatroomId, role);

      // Stop tracking in all remote agent services (pid tracking is per-service)
      for (const service of ctx.agentServices.values()) {
        service.untrack(pid);
      }

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

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
