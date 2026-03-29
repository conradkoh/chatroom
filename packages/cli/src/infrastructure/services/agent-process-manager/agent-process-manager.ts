/**
 * AgentProcessManager — single authority for agent lifecycle management.
 *
 * Owns all state transitions, PID tracking, process spawning/killing,
 * crash loop protection, rate limiting, and backend event emission.
 *
 * State model per (chatroomId, role):
 *   idle → spawning → running → idle (on exit)
 *                  ↘ idle (on failure)
 *   running → stopping → idle (on stop)
 *
 * Phase 1: standalone, no caller changes. Built and tested in isolation.
 */

import { api } from '../../../api.js';
import type { CrashLoopTracker } from '../../machine/crash-loop-tracker.js';
import { resolveStopReason } from '../../machine/stop-reason.js';
import type { StopReason } from '../../machine/stop-reason.js';
import type { AgentHarness } from '../../machine/types.js';
import type { RemoteAgentService, SpawnResult } from '../remote-agents/remote-agent-service.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentSlotState = 'idle' | 'spawning' | 'running' | 'stopping';

export interface AgentSlot {
  state: AgentSlotState;
  pid?: number;
  harness?: AgentHarness;
  model?: string;
  workingDir?: string;
  startedAt?: number;
  /** Promise that resolves when a pending spawn or stop completes */
  pendingOperation?: Promise<OperationResult>;
}

export interface OperationResult {
  success: boolean;
  pid?: number;
  error?: string;
}

export interface EnsureRunningOpts {
  chatroomId: string;
  role: string;
  agentHarness: AgentHarness;
  model?: string;
  workingDir: string;
  reason: string;
}

export interface StopOpts {
  chatroomId: string;
  role: string;
  reason: StopReason;
  /** PID from the backend event — used as fallback when the daemon has no slot PID (e.g. after restart). */
  pid?: number;
}

export interface HandleExitOpts {
  chatroomId: string;
  role: string;
  pid: number;
  code: number | null;
  signal: string | null;
}

export interface AgentProcessManagerDeps {
  agentServices: Map<string, RemoteAgentService>;
  /**
   * Backend client for Convex queries/mutations.
   * Uses `any` because the Convex client type is complex and varies by context.
   * All call sites use typed `api.*` references which provide compile-time safety.
   */
  backend: {
    query: (fn: any, args: any) => Promise<any>;
    mutation: (fn: any, args: any) => Promise<any>;
  };
  sessionId: string;
  machineId: string;
  processes: { kill: (pid: number, signal?: number | NodeJS.Signals) => void };
  clock: { delay: (ms: number) => Promise<void>; now: () => number };
  fs: { stat: (path: string) => Promise<{ isDirectory: () => boolean }> };
  persistence: {
    persistAgentPid: (
      machineId: string,
      chatroomId: string,
      role: string,
      pid: number,
      harness: AgentHarness
    ) => void;
    clearAgentPid: (machineId: string, chatroomId: string, role: string) => void;
    listAgentEntries: (machineId: string) => Array<{
      chatroomId: string;
      role: string;
      entry: { pid: number; harness: AgentHarness };
    }>;
  };
  spawning: {
    shouldAllowSpawn: (
      chatroomId: string,
      reason: string
    ) => { allowed: boolean; retryAfterMs?: number };
    recordSpawn: (chatroomId: string) => void;
    recordExit: (chatroomId: string) => void;
  };
  crashLoop: CrashLoopTracker;
  convexUrl: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

// ─── Retry Queue Types ────────────────────────────────────────────────────────

/** Arguments for a queued recordAgentExited call that failed and needs retry. */
interface RetryQueueItem {
  role: string;
  args: {
    sessionId: string;
    machineId: string;
    chatroomId: string;
    role: string;
    pid: number;
    stopReason?: string;
    stopSignal?: string;
    exitCode?: number;
    signal?: string;
    agentHarness?: string;
  };
}

/** Interval (ms) between retry attempts for failed agent exit events. */
const AGENT_EXIT_RETRY_INTERVAL_MS = 10_000;

// ─── Manager ──────────────────────────────────────────────────────────────────

export class AgentProcessManager {
  private readonly deps: AgentProcessManagerDeps;
  private readonly slots = new Map<string, AgentSlot>();

  /** Queue of failed recordAgentExited calls awaiting retry. */
  private readonly exitRetryQueue: RetryQueueItem[] = [];
  /** Active retry interval timer handle, or null if queue is empty. */
  private exitRetryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: AgentProcessManagerDeps) {
    this.deps = deps;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async ensureRunning(opts: EnsureRunningOpts): Promise<OperationResult> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.getOrCreateSlot(key);

    // Check current state
    if (slot.state === 'running') {
      return { success: true, pid: slot.pid };
    }
    if (slot.state === 'spawning' && slot.pendingOperation) {
      return slot.pendingOperation;
    }
    if (slot.state === 'stopping' && slot.pendingOperation) {
      await slot.pendingOperation;
      // After stopping completes, proceed to spawn
    }

    // Create the spawn operation promise
    const operation = this.doEnsureRunning(key, slot, opts);
    slot.pendingOperation = operation;

    return operation;
  }

  async stop(opts: StopOpts): Promise<{ success: boolean }> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.slots.get(key);

    if (!slot || slot.state === 'idle') {
      // Slot is already idle — no process to kill. But if the backend provided a
      // PID (e.g. after daemon restart), attempt to kill that process directly.
      const eventPid = opts.pid;
      if (eventPid && eventPid > 0) {
        try {
          this.deps.processes.kill(eventPid, 'SIGTERM');
        } catch {
          // Process may already be dead — that's fine.
        }
      }

      // Still notify the backend so participant status is cleaned up.
      const exitArgs1 = {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId: opts.chatroomId,
        role: opts.role,
        pid: eventPid ?? 0, // Use backend PID if available, else 0
        stopReason: opts.reason,
        exitCode: undefined as number | undefined,
        signal: undefined as string | undefined,
        agentHarness: undefined as string | undefined,
      };
      this.deps.backend
        .mutation(api.machines.recordAgentExited, exitArgs1)
        .catch((err: Error) => {
          console.log(`   ⚠️  Failed to record agent exit (idle cleanup): ${err.message}`);
          this.queueExitRetry({ role: opts.role, args: exitArgs1 });
        });
      return { success: true };
    }
    if (slot.state === 'stopping' && slot.pendingOperation) {
      await slot.pendingOperation;
      return { success: true };
    }

    const pid = slot.pid;
    if (!pid) {
      slot.state = 'idle';
      slot.pendingOperation = undefined;
      return { success: true };
    }

    // CRITICAL: Set stopping state BEFORE any async operations to prevent
    // race condition where onExit callback fires before the guard can check.
    // This ensures handleExit() will see state === 'stopping' and return early.
    slot.state = 'stopping';

    const operation = this.doStop(key, slot, pid, opts);
    slot.pendingOperation = operation;

    await operation;
    return { success: true };
  }

  handleExit(opts: HandleExitOpts): void {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.slots.get(key);

    // Ignore stale exits — PID must match
    if (!slot || slot.pid !== opts.pid) {
      return;
    }

    // If the slot is in 'stopping' state, doStop() owns the lifecycle —
    // it will handle cleanup and emit the exit event. Skip here to avoid
    // duplicate agent.exited events.
    if (slot.state === 'stopping') {
      return;
    }

    // Derive stop reason from exit info (stateless — no map lookup needed)
    const stopReason: StopReason = resolveStopReason(opts.code, opts.signal);

    // Record exit in spawning service
    this.deps.spawning.recordExit(opts.chatroomId);

    // Capture slot info before clearing
    const harness = slot.harness;
    const model = slot.model;
    const workingDir = slot.workingDir;

    // Transition: running → idle
    slot.state = 'idle';
    slot.pid = undefined;
    slot.startedAt = undefined;
    slot.pendingOperation = undefined;

    // Emit agent.exited to backend (fire-and-forget)
    const exitArgs2 = {
      sessionId: this.deps.sessionId,
      machineId: this.deps.machineId,
      chatroomId: opts.chatroomId,
      role: opts.role,
      pid: opts.pid,
      stopReason,
      stopSignal: stopReason === 'agent_process.signal' ? (opts.signal ?? undefined) : undefined,
      exitCode: opts.code ?? undefined,
      signal: opts.signal ?? undefined,
      agentHarness: harness,
    };
    this.deps.backend
      .mutation(api.machines.recordAgentExited, exitArgs2)
      .catch((err: Error) => {
        console.log(`   ⚠️  Failed to record agent exit event: ${err.message}`);
        this.queueExitRetry({ role: opts.role, args: exitArgs2 });
      });

    // Clear from disk
    this.deps.persistence.clearAgentPid(this.deps.machineId, opts.chatroomId, opts.role);

    // Untrack in agent services
    for (const service of this.deps.agentServices.values()) {
      service.untrack(opts.pid);
    }

    // Restart decision
    const isIntentionalStop = stopReason === 'user.stop' || stopReason === 'platform.team_switch' || stopReason === 'daemon.shutdown';
    const isDaemonRespawn = stopReason === 'daemon.respawn';

    if (isIntentionalStop) {
      this.deps.crashLoop.clear(opts.chatroomId, opts.role);
      return; // No restart
    }

    if (isDaemonRespawn) {
      return; // Caller will ensureRunning
    }

    // Auto-restart (if we have enough info)
    if (!harness || !workingDir) {
      console.log(
        `[AgentProcessManager] ⚠️  Cannot restart — missing harness or workingDir ` +
          `(role: ${opts.role}, harness: ${harness ?? 'none'}, workingDir: ${workingDir ?? 'none'})`
      );
      return;
    }

    this.ensureRunning({
      chatroomId: opts.chatroomId,
      role: opts.role,
      agentHarness: harness,
      model,
      workingDir,
      reason: 'platform.crash_recovery',
    }).catch((err: Error) => {
      console.log(`   ⚠️  Failed to restart agent: ${err.message}`);

      // Emit start-failed event
      this.deps.backend
        .mutation(api.machines.emitAgentStartFailed, {
          sessionId: this.deps.sessionId,
          machineId: this.deps.machineId,
          chatroomId: opts.chatroomId,
          role: opts.role,
          error: err.message,
        })
        .catch((emitErr: Error) => {
          console.log(`   ⚠️  Failed to emit startFailed event: ${emitErr.message}`);
        });
    });
  }

  getSlot(chatroomId: string, role: string): AgentSlot | undefined {
    return this.slots.get(agentKey(chatroomId, role));
  }

  listActive(): Array<{ chatroomId: string; role: string; slot: AgentSlot }> {
    const result: Array<{ chatroomId: string; role: string; slot: AgentSlot }> = [];
    for (const [key, slot] of this.slots) {
      if (slot.state === 'running' || slot.state === 'spawning') {
        const [chatroomId, role] = key.split(':');
        result.push({ chatroomId, role, slot });
      }
    }
    return result;
  }

  async recover(): Promise<void> {
    const entries = this.deps.persistence.listAgentEntries(this.deps.machineId);
    let recovered = 0;
    let cleaned = 0;

    for (const { chatroomId, role, entry } of entries) {
      const key = agentKey(chatroomId, role);
      let alive = false;
      try {
        this.deps.processes.kill(entry.pid, 0); // Signal 0 = check if alive
        alive = true;
      } catch {
        alive = false;
      }

      if (alive) {
        this.slots.set(key, {
          state: 'running',
          pid: entry.pid,
          harness: entry.harness,
        });
        recovered++;
      } else {
        this.deps.persistence.clearAgentPid(this.deps.machineId, chatroomId, role);
        cleaned++;
      }
    }

    console.log(`[AgentProcessManager] Recovery: ${recovered} alive, ${cleaned} cleaned up`);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private getOrCreateSlot(key: string): AgentSlot {
    let slot = this.slots.get(key);
    if (!slot) {
      slot = { state: 'idle' };
      this.slots.set(key, slot);
    }
    return slot;
  }

  /**
   * Queue a failed recordAgentExited call for retry.
   * Starts the retry interval timer if not already running.
   */
  private queueExitRetry(item: RetryQueueItem): void {
    this.exitRetryQueue.push(item);
    if (this.exitRetryTimer === null) {
      this.exitRetryTimer = setInterval(() => {
        void this.drainExitRetryQueue();
      }, AGENT_EXIT_RETRY_INTERVAL_MS);
      // Allow process to exit even if the timer is still active
      this.exitRetryTimer.unref?.();
    }
  }

  /**
   * Attempt to flush all queued agent exit events.
   * Successful items are removed; failures remain for the next cycle.
   * When the queue is empty, the retry interval is stopped.
   */
  private async drainExitRetryQueue(): Promise<void> {
    if (this.exitRetryQueue.length === 0) {
      this.stopExitRetryTimer();
      return;
    }

    console.log(
      `[AgentProcessManager] Retrying ${this.exitRetryQueue.length} pending agent exit event(s)...`
    );

    // Iterate in reverse so splice by index is safe
    for (let i = this.exitRetryQueue.length - 1; i >= 0; i--) {
      const item = this.exitRetryQueue[i];
      try {
        await this.deps.backend.mutation(api.machines.recordAgentExited, item.args);
        this.exitRetryQueue.splice(i, 1);
        console.log(
          `[AgentProcessManager] ✅ Successfully retried agent exit event for ${item.role}`
        );
      } catch {
        // Keep in queue for next cycle
      }
    }

    if (this.exitRetryQueue.length === 0) {
      this.stopExitRetryTimer();
    }
  }

  private stopExitRetryTimer(): void {
    if (this.exitRetryTimer !== null) {
      clearInterval(this.exitRetryTimer);
      this.exitRetryTimer = null;
    }
  }

  private async doEnsureRunning(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts
  ): Promise<OperationResult> {
    // Transition: idle → spawning
    slot.state = 'spawning';

    try {
      // Gate 1: Rate limit check
      const spawnCheck = this.deps.spawning.shouldAllowSpawn(opts.chatroomId, opts.reason);
      if (!spawnCheck.allowed) {
        slot.state = 'idle';
        slot.pendingOperation = undefined;
        return { success: false, error: 'rate_limited' };
      }

      // Gate 2: Crash loop check (only for crash recovery)
      if (opts.reason === 'platform.crash_recovery') {
        const loopCheck = this.deps.crashLoop.record(opts.chatroomId, opts.role);
        if (!loopCheck.allowed) {
          // Emit restartLimitReached event
          this.deps.backend
            .mutation(api.machines.emitRestartLimitReached, {
              sessionId: this.deps.sessionId,
              machineId: this.deps.machineId,
              chatroomId: opts.chatroomId,
              role: opts.role,
              restartCount: loopCheck.restartCount,
              windowMs: loopCheck.windowMs,
            })
            .catch((err: Error) => {
              console.log(`   ⚠️  Failed to emit restartLimitReached event: ${err.message}`);
            });

          slot.state = 'idle';
          slot.pendingOperation = undefined;
          return { success: false, error: 'crash_loop' };
        }
      }

      // Gate 3: Validate working directory
      try {
        const dirStat = await this.deps.fs.stat(opts.workingDir);
        if (!dirStat.isDirectory()) {
          slot.state = 'idle';
          slot.pendingOperation = undefined;
          return {
            success: false,
            error: `Working directory is not a directory: ${opts.workingDir}`,
          };
        }
      } catch {
        slot.state = 'idle';
        slot.pendingOperation = undefined;
        return { success: false, error: `Working directory does not exist: ${opts.workingDir}` };
      }

      // Gate 4: Kill stale process (defensive)
      if (slot.pid) {
        try {
          this.deps.processes.kill(-slot.pid, 'SIGTERM');
        } catch {
          // Process may already be dead
        }
        slot.pid = undefined;
      }

      // Step 5: Fetch init prompt
      let initPromptResult;
      try {
        initPromptResult = await this.deps.backend.query(api.messages.getInitPrompt, {
          sessionId: this.deps.sessionId,
          chatroomId: opts.chatroomId,
          role: opts.role,
          convexUrl: this.deps.convexUrl,
        });
      } catch (e) {
        slot.state = 'idle';
        slot.pendingOperation = undefined;
        return { success: false, error: `Failed to fetch init prompt: ${(e as Error).message}` };
      }

      if (!initPromptResult?.prompt) {
        slot.state = 'idle';
        slot.pendingOperation = undefined;
        return { success: false, error: 'Failed to fetch init prompt from backend' };
      }

      // Step 6: Spawn process
      const service = this.deps.agentServices.get(opts.agentHarness);
      if (!service) {
        slot.state = 'idle';
        slot.pendingOperation = undefined;
        return { success: false, error: `Unknown agent harness: ${opts.agentHarness}` };
      }

      let spawnResult: SpawnResult;
      try {
        spawnResult = await service.spawn({
          workingDir: opts.workingDir,
          prompt: initPromptResult.initialMessage,
          systemPrompt: initPromptResult.rolePrompt,
          model: opts.model,
          context: {
            machineId: this.deps.machineId,
            chatroomId: opts.chatroomId,
            role: opts.role,
          },
        });
      } catch (e) {
        slot.state = 'idle';
        slot.pendingOperation = undefined;
        return { success: false, error: `Failed to spawn agent: ${(e as Error).message}` };
      }

      const { pid } = spawnResult;

      // Track spawn
      this.deps.spawning.recordSpawn(opts.chatroomId);

      // Transition: spawning → running
      slot.state = 'running';
      slot.pid = pid;
      slot.harness = opts.agentHarness;
      slot.model = opts.model;
      slot.workingDir = opts.workingDir;
      slot.startedAt = this.deps.clock.now();
      slot.pendingOperation = undefined;

      // Emit agent started event (fire-and-forget)
      this.deps.backend
        .mutation(api.machines.updateSpawnedAgent, {
          sessionId: this.deps.sessionId,
          machineId: this.deps.machineId,
          chatroomId: opts.chatroomId,
          role: opts.role,
          pid,
          model: opts.model,
          reason: opts.reason,
        })
        .catch((err: Error) => {
          console.log(`   ⚠️  Failed to update PID in backend: ${err.message}`);
        });

      // Persist to disk (fire-and-forget)
      try {
        this.deps.persistence.persistAgentPid(
          this.deps.machineId,
          opts.chatroomId,
          opts.role,
          pid,
          opts.agentHarness
        );
      } catch {
        // Non-critical
      }

      // Register exit handler
      spawnResult.onExit(({ code, signal }) => {
        this.handleExit({
          chatroomId: opts.chatroomId,
          role: opts.role,
          pid,
          code,
          signal,
        });
      });

      // Register agent-end handler
      if (spawnResult.onAgentEnd) {
        spawnResult.onAgentEnd(() => {
          try {
            this.deps.processes.kill(-pid, 'SIGTERM');
          } catch {
            // Process may already be dead
          }
        });
      }

      // Track token activity (throttled to 30s)
      let lastReportedTokenAt = 0;
      spawnResult.onOutput(() => {
        const now = this.deps.clock.now();
        if (now - lastReportedTokenAt >= 30_000) {
          lastReportedTokenAt = now;
          this.deps.backend
            .mutation(api.participants.updateTokenActivity, {
              sessionId: this.deps.sessionId,
              chatroomId: opts.chatroomId,
              role: opts.role,
            })
            .catch(() => {}); // fire-and-forget
        }
      });

      return { success: true, pid };
    } catch (e) {
      // Catch-all: transition back to idle on unexpected errors
      slot.state = 'idle';
      slot.pendingOperation = undefined;
      return { success: false, error: `Unexpected error: ${(e as Error).message}` };
    }
  }

  private async doStop(
    key: string,
    slot: AgentSlot,
    pid: number,
    opts: StopOpts
  ): Promise<OperationResult> {
    // Note: slot.state is already set to 'stopping' by stop() before calling doStop().
    // This ensures handleExit() will see the correct state and return early.

    try {
      // SIGTERM to process group
      try {
        this.deps.processes.kill(-pid, 'SIGTERM');
      } catch {
        // Process may already be dead
      }

      // Poll for 10 seconds
      let dead = false;
      for (let i = 0; i < 20; i++) {
        await this.deps.clock.delay(500);
        try {
          this.deps.processes.kill(pid, 0);
        } catch {
          dead = true;
          break;
        }
      }

      // If still alive, SIGKILL
      if (!dead) {
        try {
          this.deps.processes.kill(-pid, 'SIGKILL');
        } catch {
          // Already dead
        }

        // Poll for 5 more seconds
        for (let i = 0; i < 10; i++) {
          await this.deps.clock.delay(500);
          try {
            this.deps.processes.kill(pid, 0);
          } catch {
            dead = true;
            break;
          }
        }
      }
    } catch {
      // Process cleanup is best-effort
    }

    // Transition: stopping → idle
    slot.state = 'idle';
    slot.pid = undefined;
    slot.startedAt = undefined;
    slot.pendingOperation = undefined;

    // Emit agent.exited to backend (fire-and-forget)
    const exitArgs3 = {
      sessionId: this.deps.sessionId,
      machineId: this.deps.machineId,
      chatroomId: opts.chatroomId,
      role: opts.role,
      pid,
      stopReason: opts.reason,
      exitCode: undefined as number | undefined,
      signal: undefined as string | undefined,
      agentHarness: slot.harness,
    };
    this.deps.backend
      .mutation(api.machines.recordAgentExited, exitArgs3)
      .catch((err: Error) => {
        console.log(`   ⚠️  Failed to record agent exit event: ${err.message}`);
        this.queueExitRetry({ role: opts.role, args: exitArgs3 });
      });

    // Clear from disk
    this.deps.persistence.clearAgentPid(this.deps.machineId, opts.chatroomId, opts.role);

    // Untrack in agent services
    for (const service of this.deps.agentServices.values()) {
      service.untrack(pid);
    }

    return { success: true };
  }
}
