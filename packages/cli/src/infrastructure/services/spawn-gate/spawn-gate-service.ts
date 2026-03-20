/**
 * SpawnGateService — unified spawn policy gate.
 *
 * Consolidates all spawn policy checks (deadline, rate limit, concurrent limit,
 * crash loop) into a single service. Both the event-stream path (onRequestStartAgent)
 * and the crash recovery path (onAgentExited) go through this gate, ensuring
 * consistent enforcement.
 *
 * After policy checks pass, delegates to executeStartAgent to actually spawn.
 */

import type { Id } from '../../../api.js';
import { api } from '../../../api.js';
import { executeStartAgent } from '../../../commands/machine/daemon-start/handlers/start-agent.js';
import type {
  AgentHarness,
  DaemonContext,
  StartAgentReason,
} from '../../../commands/machine/daemon-start/types.js';
import type { CrashLoopTracker } from '../../machine/crash-loop-tracker.js';
import type { SpawningOps } from '../../../commands/machine/daemon-start/deps.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpawnRequest {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: AgentHarness;
  model?: string;
  workingDir?: string;
  reason: StartAgentReason;
  /** Optional — only set for event-stream requests (agent.requestStart). */
  deadline?: number;
}

export interface SpawnResult {
  spawned: boolean;
  reason: 'ok' | 'expired' | 'rate_limited' | 'crash_loop' | 'spawn_failed';
  restartCount?: number;
}

export interface SpawnGateDeps {
  spawning: SpawningOps;
  crashLoop: CrashLoopTracker;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SpawnGateService {
  private readonly spawning: SpawningOps;
  private readonly crashLoop: CrashLoopTracker;

  constructor(deps: SpawnGateDeps) {
    this.spawning = deps.spawning;
    this.crashLoop = deps.crashLoop;
  }

  /**
   * Run all policy checks and, if allowed, spawn the agent.
   *
   * Checks (in order):
   * 1. Deadline — reject if expired
   * 2. Rate limit + concurrent limit — reject if not allowed
   * 3. Crash loop — reject if in a crash loop (only for platform.crash_recovery)
   * 4. Spawn — delegate to executeStartAgent
   */
  async requestSpawn(ctx: DaemonContext, request: SpawnRequest): Promise<SpawnResult> {
    const { chatroomId, role, reason, deadline } = request;

    // ── Gate 1: Deadline ─────────────────────────────────────────────────
    if (deadline !== undefined && Date.now() > deadline) {
      return { spawned: false, reason: 'expired' };
    }

    // ── Gate 2: Rate limit + concurrent limit ────────────────────────────
    const spawnCheck = this.spawning.shouldAllowSpawn(chatroomId, reason);
    if (!spawnCheck.allowed) {
      return { spawned: false, reason: 'rate_limited' };
    }

    // ── Gate 3: Crash loop (only for crash recovery) ─────────────────────
    if (reason === 'platform.crash_recovery') {
      const loopCheck = this.crashLoop.record(chatroomId, role);
      if (!loopCheck.allowed) {
        const windowSec = Math.round(loopCheck.windowMs / 1000);
        console.log(
          `[SpawnGate] 🚫  Crash loop detected for ${role} — ` +
            `${loopCheck.restartCount} restarts within ${windowSec}s window. Halting restarts.`
        );

        // Emit observability event to the backend event stream.
        ctx.deps.backend
          .mutation(api.machines.emitRestartLimitReached, {
            sessionId: ctx.sessionId,
            machineId: ctx.machineId,
            chatroomId: chatroomId as Id<'chatroom_rooms'>,
            role,
            restartCount: loopCheck.restartCount,
            windowMs: loopCheck.windowMs,
          })
          .catch((err: Error) => {
            console.log(`   ⚠️  Failed to emit restartLimitReached event: ${err.message}`);
          });

        return { spawned: false, reason: 'crash_loop', restartCount: loopCheck.restartCount };
      }
    }

    // ── Gate 4: Spawn ────────────────────────────────────────────────────
    const result = await executeStartAgent(ctx, {
      chatroomId: request.chatroomId,
      role: request.role,
      agentHarness: request.agentHarness,
      model: request.model,
      workingDir: request.workingDir,
      reason: request.reason,
    });

    if (result.failed) {
      return { spawned: false, reason: 'spawn_failed' };
    }

    return { spawned: true, reason: 'ok' };
  }

  /**
   * Clear crash loop history for an agent.
   * Call when the agent is intentionally stopped (user.stop) to reset the window.
   */
  clearCrashLoop(chatroomId: string, role: string): void {
    this.crashLoop.clear(chatroomId, role);
  }
}
