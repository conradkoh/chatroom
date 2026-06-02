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

import { untrackChildPid } from '../../../commands/machine/daemon-start/handlers/orphan-tracker.js';
import { isProcessAlive } from '../../deps/process.js';
import { api } from '../../../api.js';
import type { CrashLoopTracker } from '../../machine/crash-loop-tracker.js';
import { resolveStopReason } from '../../machine/stop-reason.js';
import type { StopReason } from '../../machine/stop-reason.js';
import type { AgentHarness } from '../../machine/types.js';
import type { Signals } from '../../types/signals.js';
import type { RemoteAgentService, SpawnResult } from '../remote-agents/remote-agent-service.js';
import { OpenCodeSdkAgentService } from '../remote-agents/opencode-sdk/opencode-sdk-agent-service.js';
import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';
import { composeResumeMessage } from '@workspace/backend/prompts/generator.js';
import { createSpawnPrompt } from '../remote-agents/spawn-prompt.js';

function isOpencodeSdkResumeService(service: RemoteAgentService): service is OpenCodeSdkAgentService {
  return (
    service.id === 'opencode-sdk' &&
    typeof (service as OpenCodeSdkAgentService).getResumeSnapshot === 'function' &&
    typeof (service as OpenCodeSdkAgentService).resumeFromSnapshot === 'function'
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentSlotState = 'idle' | 'spawning' | 'running' | 'stopping';

export interface AgentSlot {
  state: AgentSlotState;
  pid?: number;
  harness?: AgentHarness;
  /** Harness-native session ID when supportsSessionResume is true. */
  harnessSessionId?: string;
  model?: string;
  workingDir?: string;
  startedAt?: number;
  /** Promise that resolves when a pending spawn or stop completes */
  pendingOperation?: Promise<OperationResult>;
  /** Guards against overlapping resumeTurn + emit cycles from duplicate agent_end signals. */
  resumeInFlight?: boolean;
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
  /** When true (default), try to resume the daemon's last session on first launch. */
  wantResume?: boolean;
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
  processes: { kill: (pid: number, signal?: number | Signals) => void };
  clock: { delay: (ms: number) => Promise<void>; now: () => number };
  fs: { stat: (path: string) => Promise<{ isDirectory: () => boolean }> };
  persistence: {
    persistAgentPid: (
      machineId: string,
      chatroomId: string,
      role: string,
      pid: number,
      harness: AgentHarness
    ) => Promise<void>;
    clearAgentPid: (machineId: string, chatroomId: string, role: string) => Promise<void>;
    listAgentEntries: (machineId: string) => Promise<{
      chatroomId: string;
      role: string;
      entry: { pid: number; harness: AgentHarness };
    }[]>;
  };
  spawning: {
    shouldAllowSpawn: (
      chatroomId: string,
      reason: string,
      options?: { bypassConcurrentLimit?: boolean }
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
  /** Latest harness session ID per chatroom+role — in-memory only (lost on daemon restart). */
  private readonly lastHarnessSessions = new Map<
    string,
    { harnessSessionId: string; harness: AgentHarness }
  >();

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

    // Stale slot — process died without onExit; reset before kill/spawn
    if (slot.state === 'running' && slot.pid && !isProcessAlive(this.deps.processes.kill, slot.pid)) {
      slot.state = 'idle';
      slot.pid = undefined;
      slot.harness = undefined;
      slot.harnessSessionId = undefined;
      slot.model = undefined;
      slot.workingDir = undefined;
      slot.startedAt = undefined;
      slot.pendingOperation = undefined;
    }

    if (slot.pendingOperation) {
      if (slot.state === 'stopping') {
        await slot.pendingOperation;
      } else {
        return slot.pendingOperation;
      }
    }

    const operation = this.executeEnsureRunning(key, slot, opts);
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
      this.deps.backend.mutation(api.machines.recordAgentExited, exitArgs1).catch((err: Error) => {
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

  private async handleAgentEnd(opts: {
    chatroomId: string;
    role: string;
    pid: number;
    harness: AgentHarness;
  }): Promise<void> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.slots.get(key);
    if (slot?.resumeInFlight) {
      console.log(
        `[AgentProcessManager] agent_end: skipping duplicate resume for ${opts.role} (resume already in flight)`
      );
      return;
    }

    const capabilities = getHarnessCapabilities(opts.harness);

    console.log(
      `[AgentProcessManager] agent_end: role=${opts.role} pid=${opts.pid} harness=${opts.harness} supportsResume=${capabilities.supportsSessionResume}`
    );

    if (capabilities.supportsSessionResume) {
      const service = this.deps.agentServices.get(opts.harness);
      if (service?.resumeTurn) {
        if (slot) {
          slot.resumeInFlight = true;
        }
        try {
          const resumePrompt = composeResumeMessage({
            chatroomId: opts.chatroomId,
            role: opts.role,
            convexUrl: this.deps.convexUrl,
          });
          await service.resumeTurn(opts.pid, resumePrompt);

          try {
            await this.deps.backend.mutation(api.machines.emitSessionResumed, {
              sessionId: this.deps.sessionId,
              machineId: this.deps.machineId,
              chatroomId: opts.chatroomId,
              role: opts.role,
            });
            console.log(
              `[AgentProcessManager] ✅ Emitted agent.sessionResumed for ${opts.role}`
            );
          } catch (err) {
            console.log(
              `   ⚠️  Failed to emit sessionResumed event: ${(err as Error).message}`
            );
          }

          return;
        } catch (err) {
          const reason = (err as Error).message;
          try {
            await this.deps.backend.mutation(api.machines.emitSessionResumeFailed, {
              sessionId: this.deps.sessionId,
              machineId: this.deps.machineId,
              chatroomId: opts.chatroomId,
              role: opts.role,
              reason,
            });
            console.log(
              `[AgentProcessManager] ✅ Emitted agent.sessionResumeFailed for ${opts.role}`
            );
          } catch (emitErr) {
            console.log(
              `   ⚠️  Failed to emit sessionResumeFailed event: ${(emitErr as Error).message}`
            );
          }

          console.log(
            `[AgentProcessManager] ⚠️  resumeTurn failed for ${opts.role} (pid ${opts.pid}): ${reason} — falling back to kill`
          );
        } finally {
          if (slot) {
            slot.resumeInFlight = false;
          }
        }
      }
    }

    try {
      this.deps.processes.kill(-opts.pid, 'SIGTERM');
    } catch {
      // Process may already be dead
    }
  }

  async handleExit(opts: HandleExitOpts): Promise<void> {
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
    this.deps.backend.mutation(api.machines.recordAgentExited, exitArgs2).catch((err: Error) => {
      console.log(`   ⚠️  Failed to record agent exit event: ${err.message}`);
      this.queueExitRetry({ role: opts.role, args: exitArgs2 });
    });

    // Clear from disk
    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, opts.chatroomId, opts.role);
    } catch {
      // Non-critical
    }

    // Untrack in agent services
    for (const service of this.deps.agentServices.values()) {
      service.untrack(opts.pid);
    }

    // Restart decision
    const isIntentionalStop =
      stopReason === 'user.stop' ||
      stopReason === 'platform.team_switch' ||
      stopReason === 'daemon.shutdown';
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

  listActive(): { chatroomId: string; role: string; slot: AgentSlot }[] {
    const result: { chatroomId: string; role: string; slot: AgentSlot }[] = [];
    for (const [key, slot] of this.slots) {
      if (slot.state === 'running' || slot.state === 'spawning') {
        const [chatroomId, role] = key.split(':');
        result.push({ chatroomId, role, slot });
      }
    }
    return result;
  }

  async recover(): Promise<void> {
    let entries: {
      chatroomId: string;
      role: string;
      entry: { pid: number; harness: AgentHarness };
    }[] = [];
    try {
      entries = await this.deps.persistence.listAgentEntries(this.deps.machineId);
    } catch (err) {
      console.warn(
        `[AgentProcessManager] ⚠️ Failed to load persisted agent entries: ${(err as Error).message}`
      );
    }

    let killed = 0;
    let cleaned = 0;

    for (const { chatroomId, role, entry } of entries) {
      if (isProcessAlive(this.deps.processes.kill, entry.pid)) {
        // Stale process from a previous daemon — kill the process group and clear
        // backend state instead of adopting as "running" (no onExit handlers).
        await this.stopPersistedProcess(entry.pid, entry.harness);

        const exitArgs = {
          sessionId: this.deps.sessionId,
          machineId: this.deps.machineId,
          chatroomId,
          role,
          pid: entry.pid,
          stopReason: 'daemon.shutdown' as const,
          exitCode: undefined as number | undefined,
          signal: undefined as string | undefined,
          agentHarness: entry.harness,
        };
        this.deps.backend.mutation(api.machines.recordAgentExited, exitArgs).catch((err: Error) => {
          console.log(`   ⚠️  Failed to record agent exit on recovery: ${err.message}`);
          this.queueExitRetry({ role, args: exitArgs });
        });

        try {
          await this.deps.persistence.clearAgentPid(this.deps.machineId, chatroomId, role);
        } catch {
          // Non-critical
        }
        killed++;
      } else {
        try {
          await this.deps.persistence.clearAgentPid(this.deps.machineId, chatroomId, role);
        } catch {
          // Non-critical
        }
        cleaned++;
      }
    }

    console.log(`[AgentProcessManager] Recovery: ${killed} killed, ${cleaned} cleaned up`);
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

  private async stopPersistedProcess(pid: number, harness: AgentHarness): Promise<void> {
    const service = this.deps.agentServices.get(harness);
    if (service) {
      try {
        await service.stop(pid);
        service.untrack(pid);
      } catch {
        // Process cleanup is best-effort
      }
    } else {
      try {
        this.deps.processes.kill(-pid, 'SIGTERM');
      } catch {
        // Process may already be dead
      }

      for (const svc of this.deps.agentServices.values()) {
        svc.untrack(pid);
      }
    }

    untrackChildPid(pid);
  }

  /**
   * Kill any live agent process for this chatroom+role before spawning.
   * Covers in-memory slot PIDs and persisted PIDs (orphans after restart).
   */
  private async killExistingBeforeSpawn(chatroomId: string, role: string): Promise<void> {
    const key = agentKey(chatroomId, role);
    const slot = this.slots.get(key);

    if (
      slot?.pid &&
      isProcessAlive(this.deps.processes.kill, slot.pid) &&
      (slot.state === 'running' || slot.state === 'spawning')
    ) {
      const pid = slot.pid;
      slot.state = 'stopping';
      await this.doStop(key, slot, pid, { chatroomId, role, reason: 'daemon.respawn' });
    }

    let entries: {
      chatroomId: string;
      role: string;
      entry: { pid: number; harness: AgentHarness };
    }[] = [];
    try {
      entries = await this.deps.persistence.listAgentEntries(this.deps.machineId);
    } catch {
      return;
    }

    const persisted = entries.find(
      (e) => e.chatroomId === chatroomId && e.role.toLowerCase() === role.toLowerCase()
    );
    if (!persisted) {
      return;
    }

    const { pid, harness } = persisted.entry;
    if (!isProcessAlive(this.deps.processes.kill, pid)) {
      try {
        await this.deps.persistence.clearAgentPid(this.deps.machineId, chatroomId, role);
      } catch {
        // Non-critical
      }
      return;
    }

    const currentSlot = this.slots.get(key);
    if (currentSlot?.pid === pid && currentSlot.state !== 'idle') {
      return;
    }

    await this.stopPersistedProcess(pid, harness);

    const exitArgs = {
      sessionId: this.deps.sessionId,
      machineId: this.deps.machineId,
      chatroomId,
      role,
      pid,
      stopReason: 'daemon.respawn' as const,
      exitCode: undefined as number | undefined,
      signal: undefined as string | undefined,
      agentHarness: harness,
    };
    this.deps.backend.mutation(api.machines.recordAgentExited, exitArgs).catch((err: Error) => {
      console.log(`   ⚠️  Failed to record agent exit before respawn: ${err.message}`);
      this.queueExitRetry({ role, args: exitArgs });
    });

    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, chatroomId, role);
    } catch {
      // Non-critical
    }
  }

  private async executeEnsureRunning(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts
  ): Promise<OperationResult> {
    try {
      await this.killExistingBeforeSpawn(opts.chatroomId, opts.role);
      const result = await this.doEnsureRunning(key, slot, opts);
      if (!result.success && opts.reason === 'platform.auto_restart_on_new_context') {
        console.log(
          `[AgentProcessManager] Context auto-restart failed (${result.error ?? 'unknown'}), ` +
            `attempting crash recovery (rate-limited)`
        );
        return await this.doEnsureRunning(key, slot, {
          ...opts,
          reason: 'platform.crash_recovery',
        });
      }
      return result;
    } finally {
      if (slot.pendingOperation) {
        slot.pendingOperation = undefined;
      }
    }
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

  /**
   * When wantResume is true on first launch, try to reconnect via persisted harness
   * snapshot (opencode-sdk). Returns SpawnResult on success; null falls through to spawn.
   */
  private async tryFirstLaunchResume(opts: {
    chatroomId: string;
    role: string;
    agentHarness: AgentHarness;
    workingDir: string;
    model?: string;
    initPrompt: string;
    systemPrompt: string;
    service: RemoteAgentService;
  }): Promise<SpawnResult | null> {
    const capabilities = getHarnessCapabilities(opts.agentHarness);
    if (!capabilities.supportsSessionResume) {
      return null;
    }

    if (opts.agentHarness !== 'opencode-sdk' || !isOpencodeSdkResumeService(opts.service)) {
      return null;
    }

    const snapshot = opts.service.getResumeSnapshot(
      this.deps.machineId,
      opts.chatroomId,
      opts.role
    );
    if (!snapshot) {
      await this.emitSessionResumeFailed(
        opts.chatroomId,
        opts.role,
        'no resume snapshot on disk'
      );
      return null;
    }

    try {
      const spawnResult = await opts.service.resumeFromSnapshot(
        {
          workingDir: opts.workingDir,
          prompt: createSpawnPrompt(opts.initPrompt),
          systemPrompt: opts.systemPrompt,
          model: opts.model,
          context: {
            machineId: this.deps.machineId,
            chatroomId: opts.chatroomId,
            role: opts.role,
          },
        },
        snapshot
      );
      await this.emitSessionResumed(opts.chatroomId, opts.role);
      return spawnResult;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.emitSessionResumeFailed(opts.chatroomId, opts.role, reason);
      return null;
    }
  }

  private async emitSessionResumed(chatroomId: string, role: string): Promise<void> {
    try {
      await this.deps.backend.mutation(api.machines.emitSessionResumed, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
      });
      console.log(`[AgentProcessManager] ✅ Emitted agent.sessionResumed for ${role}`);
    } catch (err) {
      console.log(`   ⚠️  Failed to emit sessionResumed event: ${(err as Error).message}`);
    }
  }

  private async emitSessionResumeFailed(
    chatroomId: string,
    role: string,
    reason: string
  ): Promise<void> {
    try {
      await this.deps.backend.mutation(api.machines.emitSessionResumeFailed, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        reason,
      });
      console.log(`[AgentProcessManager] ✅ Emitted agent.sessionResumeFailed for ${role}`);
    } catch (err) {
      console.log(
        `   ⚠️  Failed to emit sessionResumeFailed event: ${(err as Error).message}`
      );
    }
  }

  private async doEnsureRunning(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts
  ): Promise<OperationResult> {
    // Transition: idle → spawning
    slot.state = 'spawning';
    const wantResume = opts.wantResume ?? true;

    console.log(
      `[AgentProcessManager] harness start: role=${opts.role} harness=${opts.agentHarness} wantResume=${wantResume} reason=${opts.reason}`
    );

    try {
      // Gate 1: Rate limit check
      // Bypass concurrent limit for manual user-triggered spawns
      const spawnCheck = this.deps.spawning.shouldAllowSpawn(opts.chatroomId, opts.reason, {
        bypassConcurrentLimit: opts.reason.startsWith('user.'),
      });
      if (!spawnCheck.allowed) {
        slot.state = 'idle';
        slot.pendingOperation = undefined;
        return { success: false, error: 'rate_limited' };
      }

      // Gate 2: Crash loop check (only for crash recovery)
      if (opts.reason === 'platform.crash_recovery') {
        const loopCheck = this.deps.crashLoop.record(
          opts.chatroomId,
          opts.role,
          this.deps.clock.now()
        );
        if (!loopCheck.allowed) {
          if (loopCheck.waitMs !== undefined && loopCheck.waitMs > 0) {
            // Temporary backoff - log and return backoff error (don't emit limit event)
            console.log(`   ⏳ Agent restart backoff: waiting ${loopCheck.waitMs}ms before retry`);
            slot.state = 'idle';
            slot.pendingOperation = undefined;
            return { success: false, error: 'backoff' };
          }

          // Permanent limit reached - emit restartLimitReached event
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

      let spawnResult: SpawnResult | undefined;
      if (wantResume) {
        spawnResult =
          (await this.tryFirstLaunchResume({
            chatroomId: opts.chatroomId,
            role: opts.role,
            agentHarness: opts.agentHarness,
            workingDir: opts.workingDir,
            model: opts.model,
            initPrompt: initPromptResult.initialMessage,
            systemPrompt: initPromptResult.rolePrompt,
            service,
          })) ?? undefined;
      }

      if (!spawnResult) {
        try {
          spawnResult = await service.spawn({
            workingDir: opts.workingDir,
            prompt: createSpawnPrompt(initPromptResult.initialMessage),
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
      }

      const { pid } = spawnResult;

      // Track spawn
      this.deps.spawning.recordSpawn(opts.chatroomId);

      // Transition: spawning → running
      slot.state = 'running';
      slot.pid = pid;
      slot.harness = opts.agentHarness;
      slot.harnessSessionId = spawnResult.harnessSessionId;
      if (spawnResult.harnessSessionId) {
        this.lastHarnessSessions.set(key, {
          harnessSessionId: spawnResult.harnessSessionId,
          harness: opts.agentHarness,
        });
      }
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

      // Persist to disk (best-effort)
      try {
        await this.deps.persistence.persistAgentPid(
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
        void this.handleExit({
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
          void this.handleAgentEnd({
            chatroomId: opts.chatroomId,
            role: opts.role,
            pid,
            harness: opts.agentHarness,
          });
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
      const harness = slot.harness;
      if (slot.harnessSessionId && harness) {
        this.lastHarnessSessions.set(key, {
          harnessSessionId: slot.harnessSessionId,
          harness,
        });
      }
      const service = harness ? this.deps.agentServices.get(harness) : undefined;

      if (service) {
        const preserveForResume =
          opts.reason === 'user.stop' && Boolean(slot.harnessSessionId);
        await service.stop(pid, { preserveForResume });
        // Explicitly untrack: handleExit() returns early when state==='stopping',
        // so untrack must be called here to keep the service's process map clean.
        service.untrack(pid);
      } else {
        // No registered service for this harness — fall back to direct kill-and-poll
        try {
          this.deps.processes.kill(-pid, 'SIGTERM');
        } catch {
          // Process may already be dead
        }

        let dead = false;
        for (let i = 0; i < 20; i++) {
          await this.deps.clock.delay(500);
          if (!isProcessAlive(this.deps.processes.kill, pid)) {
            dead = true;
            break;
          }
        }

        if (!dead) {
          try {
            this.deps.processes.kill(-pid, 'SIGKILL');
          } catch {
            // Already dead
          }

          for (let i = 0; i < 10; i++) {
            await this.deps.clock.delay(500);
            if (!isProcessAlive(this.deps.processes.kill, pid)) {
              dead = true;
              break;
            }
          }
        }

        for (const svc of this.deps.agentServices.values()) {
          svc.untrack(pid);
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
    this.deps.backend.mutation(api.machines.recordAgentExited, exitArgs3).catch((err: Error) => {
      console.log(`   ⚠️  Failed to record agent exit event: ${err.message}`);
      this.queueExitRetry({ role: opts.role, args: exitArgs3 });
    });

    // Clear from disk
    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, opts.chatroomId, opts.role);
    } catch {
      // Non-critical
    }

    return { success: true };
  }
}
