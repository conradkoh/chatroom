/**
 * AgentProcessManager — single authority for agent lifecycle management.
 *
 * Owns all state transitions, PID tracking, process spawning/killing,
 * crash loop protection, rate limiting, and backend event emission.
 *
 * Phase 3: Facade over AgentLifecycleService. Slot state machine (Ref,
 * transitions, spawn/stop/exit brackets, restart decisions) is delegated
 * to AgentLifecycleService. APM retains: killExistingBeforeSpawn,
 * crash-loop gate, fs validation, init-prompt fetch, daemon-memory resume,
 * backend mutations (recordAgentExited, updateSpawnedAgent, etc.),
 * recover(), turn-end queue, exit retry queue, lastHarnessSessions.
 *
 * State model per (chatroomId, role):
 *   idle → spawning → running → idle (on exit)
 *                  ↘ idle (on failure)
 *   running → stopping → idle (on stop)
 *
 * Phase 1: standalone, no caller changes. Built and tested in isolation.
 */

import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';
import {
  NATIVE_HANDOFF_REMINDER,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import { Effect } from 'effect';

import { createTurnCompletedBackend } from './turn-completed-backend.js';
import { TurnEndQueue } from './turn-end-queue.js';
import { api } from '../../../api.js';
import { untrackChildPid } from '../../../commands/machine/daemon-start/handlers/orphan-tracker.js';
import { notifyNativeHarnessSessionLostOnExit } from '../../../commands/machine/daemon-start/native-harness-session-exit.js';
import { notifyNativeSessionLost } from '../../../commands/machine/daemon-start/native-task-delivery-coordinator.js';
import type { HarnessSessionSnapshot, StopReason } from '../../../domain/agent-lifecycle/index.js';
import {
  resolveResumableHarnessSessionId,
  decideResumePathOnRestart,
  resolveStopReason,
  shouldAutoRestartAfterProcessExit,
  shouldPreserveHarnessTeardown,
  shouldRetainHarnessSessionForReconnect,
} from '../../../domain/agent-lifecycle/index.js';
import { tryAbortResumeStorm } from '../../../domain/agent-lifecycle/policies/abort-resume-storm.js';
import { appendRecentLogLine } from '../../../domain/agent-lifecycle/policies/append-recent-log-line.js';
import {
  formatPermanentHarnessFailureMessage,
  isPermanentHarnessFailure,
} from '../../../domain/agent-lifecycle/policies/classify-resume-storm-reason.js';
import {
  formatCursorSdkRunErrorMessage,
  isCursorSdkRunErrorInLogs,
} from '../../../domain/agent-lifecycle/policies/cursor-sdk-run-error.js';
import {
  CURSOR_SDK_SESSION_REOPEN_INTERVAL_MS,
  CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS,
  CURSOR_SDK_SESSION_REOPEN_REASON,
  CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS,
} from '../../../domain/agent-lifecycle/policies/cursor-sdk-session-reopen-retry.js';
import {
  formatTerminalProviderFailureMessage,
  isTerminalProviderFailureInLogs,
} from '../../../domain/agent-lifecycle/policies/terminal-provider-error.js';
import type { ResumeStormTracker } from '../../../domain/agent-lifecycle/ports/resume-storm-tracker.js';
import { handleTurnCompleted } from '../../../domain/agent-lifecycle/use-cases/handle-turn-completed.js';
import { resolveNativeSpawnPolicy } from '../../../domain/native-integration/spawn-policy.js';
import { isProcessAlive } from '../../deps/process.js';
import type { CrashLoopTracker } from '../../machine/crash-loop-tracker.js';
import { RapidResumeTracker } from '../../machine/rapid-resume-tracker.js';
import type { AgentHarness } from '../../machine/types.js';
import type { Signals } from '../../types/signals.js';
import { type AgentLifecyclePortAdapterDeps } from '../agent-lifecycle/agent-lifecycle-port-adapters.js';
import type { AgentLifecycleRuntime } from '../agent-lifecycle/agent-lifecycle-runtime.js';
import { createAgentLifecycleRuntime } from '../agent-lifecycle/agent-lifecycle-runtime.js';
import {
  AgentLifecycleService,
  type AgentLifecycleSlot,
  type EnsureRunningOpts,
  type HandleExitOpts,
  type OperationResult,
  type StopOpts,
} from '../agent-lifecycle/agent-lifecycle-types.js';
import type {
  HarnessReconnectMetadata,
  HarnessSessionIdUpdatedInfo,
  RemoteAgentService,
  SpawnResult,
} from '../remote-agents/remote-agent-service.js';
import { createSpawnPrompt } from '../remote-agents/spawn-prompt.js';

// ─── Types ────────────────────────────────────────────────────────────────────

// Re-exported from AgentLifecycleService — authoritative definitions.
// APM uses these for its imperative (async/await) public API.
export type {
  OperationResult,
  EnsureRunningOpts,
  StopOpts,
  HandleExitOpts,
} from '../agent-lifecycle/agent-lifecycle-types.js';

export type AgentSlotState = 'idle' | 'spawning' | 'running' | 'stopping';

interface ExitContext {
  harness: AgentHarness | undefined;
  model: string | undefined;
  workingDir: string | undefined;
  harnessSessionId: string | undefined;
  resumableHarnessSessionId: string | undefined;
  wantResume: boolean | undefined;
  recentLogLines: string[] | undefined;
  stopReason: StopReason;
  terminalProviderFailureHandled: boolean;
}

/** APM's internal slot — mirrors AgentLifecycleSlot with imperative-compatible fields. */
export interface AgentSlot {
  state: AgentSlotState;
  pid?: number;
  harness?: AgentHarness;
  /** Immutable spawn correlation ID for native delivery gating and ledger. */
  harnessSessionId?: string;
  /** Latest provider-native session ID for daemon-memory resume. */
  resumableHarnessSessionId?: string;
  model?: string;
  workingDir?: string;
  startedAt?: number;
  /** Promise that resolves when a pending spawn or stop completes */
  pendingOperation?: Promise<OperationResult>;
  /** Recent harness log lines for resume-storm reason classification. */
  recentLogLines?: string[];
  /** User's persisted reconnect-on-start preference for this run. */
  wantResume?: boolean;
  /** Turn-end already emitted startFailed for a terminal provider error. */
  terminalProviderFailureHandled?: boolean;
  /** Task last delivered to this native harness slot — sent on agent_end. */
  lastInFlightTaskId?: string;
  /** When the slot entered stopping — used to detect hung stop. */
  stoppingSince?: number;
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
    listAgentEntries: (machineId: string) => Promise<
      {
        chatroomId: string;
        role: string;
        entry: { pid: number; harness: AgentHarness };
      }[]
    >;
  };
  spawning: {
    shouldAllowSpawn: (
      chatroomId: string,
      reason: string
    ) => { allowed: boolean; retryAfterMs?: number };
  };
  crashLoop: CrashLoopTracker;
  convexUrl: string;
  resumeStormTracker?: ResumeStormTracker;
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

/** Max time to wait for agent stop before force-clearing a stuck stopping slot. */
export const STOPPING_TIMEOUT_MS = 30_000;

// ─── Manager ──────────────────────────────────────────────────────────────────

type ResolvedAgentProcessManagerDeps = AgentProcessManagerDeps & {
  resumeStormTracker: ResumeStormTracker;
};

export class AgentProcessManager {
  private readonly deps: ResolvedAgentProcessManagerDeps;
  /** Mirror of lifecycle service slot state — used by sync getSlot/listActive. */
  private readonly slots = new Map<string, AgentSlot>();
  /** Latest harness session reconnect context per chatroom+role — in-memory only. */
  private readonly lastHarnessSessions = new Map<string, HarnessSessionSnapshot>();

  /** Active cursor-sdk session reopen retry loops per chatroom+role. */
  private readonly sessionReopenRetryInFlight = new Set<string>();
  /** Queue of failed recordAgentExited calls awaiting retry. */
  private readonly exitRetryQueue: RetryQueueItem[] = [];
  /** Active retry interval timer handle, or null if queue is empty. */
  private exitRetryTimer: ReturnType<typeof setInterval> | null = null;
  private readonly turnEndQueue = new TurnEndQueue();
  /** Effect-native lifecycle service runtime (Phase 3). */
  private readonly lifecycle: AgentLifecycleRuntime;

  constructor(deps: AgentProcessManagerDeps) {
    this.deps = {
      ...deps,
      resumeStormTracker: deps.resumeStormTracker ?? new RapidResumeTracker(),
    };

    // Create lifecycle runtime — delegates slot state machine to AgentLifecycleService
    const portAdapterDeps: AgentLifecyclePortAdapterDeps = {
      spawning: this.deps.spawning,
      agentServices: this.deps.agentServices,
      sessionId: this.deps.sessionId,
      machineId: this.deps.machineId,
      convexUrl: this.deps.convexUrl,
      onAgentEnd: (args) => void this.runHandleAgentEnd(args),
    };
    this.lifecycle = createAgentLifecycleRuntime(portAdapterDeps);
  }

  private updateSlotsMirror(chatroomId: string, role: string, slot: AgentLifecycleSlot): void {
    const key = agentKey(chatroomId, role);
    const existing = this.slots.get(key);
    if (!existing || existing.state !== slot.state || existing.pid !== slot.pid) {
      this.slots.set(key, {
        state: slot.state,
        pid: slot.pid,
        harness: slot.harness,
        harnessSessionId: slot.harnessSessionId,
        resumableHarnessSessionId: slot.resumableHarnessSessionId,
        model: slot.model,
        workingDir: slot.workingDir,
        startedAt: slot.startedAt,
        recentLogLines: slot.recentLogLines,
        wantResume: slot.wantResume,
      });
    }
  }

  private getSlotFromMirror(chatroomId: string, role: string): AgentSlot | undefined {
    return this.slots.get(agentKey(chatroomId, role));
  }

  whenTurnEndsIdle(): Promise<void> {
    return this.turnEndQueue.whenIdle();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  private clearSlotRuntimeState(slot: AgentSlot): void {
    slot.state = 'idle';
    slot.pid = undefined;
    slot.harness = undefined;
    slot.harnessSessionId = undefined;
    slot.resumableHarnessSessionId = undefined;
    slot.model = undefined;
    slot.workingDir = undefined;
    slot.startedAt = undefined;
    slot.pendingOperation = undefined;
    slot.stoppingSince = undefined;
  }

  async ensureRunning(opts: EnsureRunningOpts): Promise<OperationResult> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.getOrCreateSlot(key);

    // Stale slot — process died without onExit; reset before kill/spawn
    if (
      slot.state === 'running' &&
      slot.pid &&
      !isProcessAlive(this.deps.processes.kill, slot.pid)
    ) {
      this.clearSlotRuntimeState(slot);
    }

    if (
      slot.state === 'stopping' &&
      (slot.stoppingSince === undefined ||
        this.deps.clock.now() - slot.stoppingSince >= STOPPING_TIMEOUT_MS)
    ) {
      await this.forceClearStuckStoppingSlot(
        key,
        slot,
        opts.chatroomId,
        opts.role,
        'daemon.stop_timeout'
      );
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

  async resumeTurnForSlot(args: {
    chatroomId: string;
    role: string;
    prompt: string;
  }): Promise<void> {
    const key = agentKey(args.chatroomId, args.role);
    const slot = this.slots.get(key);
    if (!slot?.pid || !slot.harness) {
      throw new Error(`No running agent for ${args.role}@${args.chatroomId}`);
    }
    const service = this.deps.agentServices.get(slot.harness);
    if (!service?.resumeTurn) {
      throw new Error(`Harness ${slot.harness} does not support resumeTurn`);
    }
    await service.resumeTurn(slot.pid, args.prompt);
  }

  private async injectHarnessReminder(
    chatroomId: string,
    role: string,
    prompt: string
  ): Promise<void> {
    const key = agentKey(chatroomId, role);
    const slot = this.slots.get(key);
    if (!slot?.pid || !slot.harness) return;
    const service = this.deps.agentServices.get(slot.harness);
    if (!service?.resumeTurn) return;
    await service.resumeTurn(slot.pid, prompt);
  }

  async stop(opts: StopOpts): Promise<{ success: boolean }> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.slots.get(key);

    const earlyResult = await this.handleStopEarlyReturns(slot, opts, key);
    if (earlyResult) {
      return earlyResult;
    }

    // At this point, slot is guaranteed to be defined with a pid; state already 'stopping'
    // and pendingOperation already set by handleStopEarlyReturns
    const actualSlot = slot as NonNullable<typeof slot>;
    if (actualSlot.pendingOperation) {
      await actualSlot.pendingOperation;
    }
    return { success: true };
  }

  private async handleStopEarlyReturns(
    slot: AgentSlot | undefined,
    opts: StopOpts,
    key: string
  ): Promise<{ success: boolean } | null> {
    if (!slot || slot.state === 'idle') {
      await this.killAndRecordForIdleSlot(slot, opts);
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

    // CRITICAL: claim stopping synchronously, then start doStop and store the promise
    // so concurrent callers can await the same operation instead of spawning their own.
    slot.state = 'stopping';
    slot.stoppingSince = this.deps.clock.now();
    const operation = this.doStop(key, slot, pid, opts);
    slot.pendingOperation = operation;
    return null;
  }

  private async killAndRecordForIdleSlot(
    slot: AgentSlot | undefined,
    opts: StopOpts
  ): Promise<void> {
    const eventPid = opts.pid;
    if (eventPid && eventPid > 0) {
      try {
        this.deps.processes.kill(eventPid, 'SIGTERM');
      } catch {
        // Process may already be dead
      }
    }

    const exitArgs1 = {
      sessionId: this.deps.sessionId,
      machineId: this.deps.machineId,
      chatroomId: opts.chatroomId,
      role: opts.role,
      pid: eventPid ?? 0,
      stopReason: opts.reason,
      exitCode: undefined as number | undefined,
      signal: undefined as string | undefined,
      agentHarness: undefined as string | undefined,
    };
    this.deps.backend.mutation(api.machines.recordAgentExited, exitArgs1).catch((err: Error) => {
      console.log(`   ⚠️  Failed to record agent exit (idle cleanup): ${err.message}`);
      this.queueExitRetry({ role: opts.role, args: exitArgs1 });
    });
  }

  // fallow-ignore-next-line complexity
  private async runHandleAgentEnd(opts: {
    chatroomId: string;
    role: string;
    pid: number;
    harness: AgentHarness;
  }): Promise<void> {
    const slot = this.slots.get(agentKey(opts.chatroomId, opts.role));
    const capabilities = getHarnessCapabilities(opts.harness);

    this.updateSlotsMirror(opts.chatroomId, opts.role, {
      state: slot?.state ?? 'idle',
      pid: slot?.pid,
      harness: slot?.harness,
      harnessSessionId: slot?.harnessSessionId,
      model: slot?.model,
      workingDir: slot?.workingDir,
      startedAt: slot?.startedAt,
      recentLogLines: slot?.recentLogLines,
      wantResume: slot?.wantResume,
    });

    console.log(
      `[AgentProcessManager] lifecycle.turn.completed: role=${opts.role} pid=${opts.pid} harness=${opts.harness}`
    );

    if (capabilities.supportsNativeIntegration) {
      await this.runHandleNativeTurnEnd(opts, slot);
      return;
    }

    const result = await handleTurnCompleted(
      {
        resumeStormTracker: this.deps.resumeStormTracker,
        backend: createTurnCompletedBackend(this.deps),
        now: () => this.deps.clock.now(),
        killProcess: (pid) => {
          try {
            this.deps.processes.kill(-pid, 'SIGTERM');
          } catch {
            // Process may already be dead
          }
        },
        stopAgent: (args) => this.stop(args),
      },
      {
        chatroomId: opts.chatroomId,
        role: opts.role,
        pid: opts.pid,
      },
      slot
    );

    if (result.outcome === 'storm_aborted') {
      console.log(`[AgentProcessManager] ✅ Handled rapid resume storm for ${opts.role}`);
    } else if (result.outcome === 'killed') {
      console.log(
        `[AgentProcessManager] lifecycle.turn.completed: killed process for ${opts.role}`
      );
    } else if (result.outcome === 'killed_terminal_provider_error') {
      console.log(
        `[AgentProcessManager] ⛔ Terminal provider error for ${opts.role} — emitted agent.startFailed`
      );
    }
  }

  // fallow-ignore-next-line complexity
  private async runHandleNativeTurnEnd(
    opts: {
      chatroomId: string;
      role: string;
      pid: number;
      harness: AgentHarness;
    },
    slot: AgentSlot | undefined
  ): Promise<void> {
    if (
      await tryAbortResumeStorm(
        {
          resumeStormTracker: this.deps.resumeStormTracker,
          backend: createTurnCompletedBackend(this.deps),
          now: () => this.deps.clock.now(),
          stopAgent: (args) => this.stop(args),
        },
        {
          chatroomId: opts.chatroomId,
          role: opts.role,
          pid: opts.pid,
        },
        slot
      )
    ) {
      console.log(`[AgentProcessManager] ✅ Handled rapid resume storm for ${opts.role}`);
      return;
    }

    if (isTerminalProviderFailureInLogs(slot?.recentLogLines ?? [])) {
      if (slot) {
        slot.terminalProviderFailureHandled = true;
      }
      const error = formatTerminalProviderFailureMessage(slot?.recentLogLines ?? []);
      try {
        await createTurnCompletedBackend(this.deps).emitAgentStartFailed({
          chatroomId: opts.chatroomId,
          role: opts.role,
          error,
        });
      } catch {
        // Best-effort event emission
      }
      try {
        this.deps.processes.kill(-opts.pid, 'SIGTERM');
      } catch {
        // Process may already be dead
      }
      console.log(
        `[AgentProcessManager] ⛔ Terminal provider error for ${opts.role} — emitted agent.startFailed`
      );
      return;
    }

    try {
      const result = await this.deps.backend.mutation(api.participants.handleNativeAgentEnd, {
        sessionId: this.deps.sessionId,
        chatroomId: opts.chatroomId,
        role: opts.role,
        ...(slot?.lastInFlightTaskId ? { taskId: slot.lastInFlightTaskId } : {}),
      });

      if (result?.needsHandoffReminder) {
        await this.injectHarnessReminder(opts.chatroomId, opts.role, NATIVE_HANDOFF_REMINDER);
        console.log(`[AgentProcessManager] ⏩ Handoff reminder injected for ${opts.role}`);
        return;
      }

      console.log(`[AgentProcessManager] ✅ Native agent_end handled for ${opts.role}`);
    } catch (err) {
      console.log(`   ⚠️  Failed native agent_end for ${opts.role}: ${(err as Error).message}`);
    }
  }

  async handleExit(opts: HandleExitOpts): Promise<void> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.slots.get(key);

    if (!slot || slot.pid !== opts.pid || slot.state === 'stopping') {
      return;
    }

    const stopReason: StopReason = resolveStopReason(opts.code, opts.signal);

    const ctx = this.captureExitContext(slot, opts, stopReason);
    notifyNativeHarnessSessionLostOnExit({
      chatroomId: opts.chatroomId,
      role: opts.role,
      harness: ctx.harness,
      harnessSessionId: ctx.harnessSessionId,
      stopReason: ctx.stopReason,
      recentLogLines: ctx.recentLogLines,
      supportsDaemonMemoryResume: Boolean(
        ctx.harness && this.deps.agentServices.get(ctx.harness)?.resumeFromDaemonMemory
      ),
    });
    await this.preserveHarnessSessionOnExit(key, slot, ctx);

    const lifecyclePromise = this.lifecycle.runPromise(
      Effect.gen(function* () {
        const svc = yield* AgentLifecycleService;
        yield* svc.handleExit({
          chatroomId: opts.chatroomId,
          role: opts.role,
          pid: opts.pid,
          code: opts.code,
          signal: opts.signal,
        });
      })
    );

    this.resetSlotAfterExit(slot);
    await this.emitExitEvent(slot, opts, ctx);
    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, opts.chatroomId, opts.role);
    } catch {
      // Non-critical
    }
    this.untrackAllServices(opts.pid);

    void lifecyclePromise
      .then(() => this.dispatchRestartAfterExit(opts, ctx, key))
      .catch(() => {
        // Lifecycle error — still emit exit event (already done above)
      });
  }

  private captureExitContext(
    slot: AgentSlot,
    opts: HandleExitOpts,
    stopReason: StopReason
  ): ExitContext {
    return {
      harness: slot.harness,
      model: slot.model,
      workingDir: slot.workingDir,
      harnessSessionId: slot.harnessSessionId,
      resumableHarnessSessionId: slot.resumableHarnessSessionId,
      wantResume: slot.wantResume,
      recentLogLines: slot.recentLogLines,
      stopReason,
      terminalProviderFailureHandled: slot.terminalProviderFailureHandled === true,
    };
  }

  private recordExitHarnessSession(
    key: string,
    slot: AgentSlot,
    harness: AgentHarness,
    harnessSessionId: string,
    ctx: ExitContext
  ): void {
    const service = this.deps.agentServices.get(harness);
    const harnessMeta =
      service && slot.pid ? this.readHarnessReconnectMetadata(service, slot.pid) : undefined;
    this.recordLastHarnessSession(key, {
      harnessSessionId,
      resumableHarnessSessionId: ctx.resumableHarnessSessionId,
      harness,
      agentName: harnessMeta?.agentName ?? '',
      workingDir: ctx.workingDir ?? '',
      model: ctx.model ?? harnessMeta?.model,
    });
  }

  private async preserveHarnessSessionOnExit(
    key: string,
    slot: AgentSlot,
    ctx: ExitContext
  ): Promise<void> {
    const { harness, harnessSessionId, stopReason } = ctx;
    if (!harness || !harnessSessionId) {
      return;
    }
    const service = this.deps.agentServices.get(harness);
    if (!service?.resumeFromDaemonMemory) {
      return;
    }
    if (!shouldRetainHarnessSessionForReconnect(stopReason)) {
      return;
    }
    this.recordExitHarnessSession(key, slot, harness, harnessSessionId, ctx);
  }

  private resetSlotAfterExit(slot: AgentSlot): void {
    slot.state = 'idle';
    slot.pid = undefined;
    slot.startedAt = undefined;
    slot.pendingOperation = undefined;
  }

  private async emitExitEvent(
    slot: AgentSlot,
    opts: HandleExitOpts,
    ctx: ExitContext
  ): Promise<void> {
    const stopReason = ctx.stopReason;
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
      agentHarness: ctx.harness,
    };
    this.deps.backend.mutation(api.machines.recordAgentExited, exitArgs2).catch((err: Error) => {
      console.log(`   ⚠️  Failed to record agent exit event: ${err.message}`);
      this.queueExitRetry({ role: opts.role, args: exitArgs2 });
    });
  }

  private untrackAllServices(pid: number): void {
    for (const service of this.deps.agentServices.values()) {
      service.untrack(pid);
    }
  }

  private dispatchRestartAfterExit(opts: HandleExitOpts, ctx: ExitContext, _key: string): void {
    const stopReasonForRestart = resolveStopReason(opts.code, opts.signal);

    if (!shouldAutoRestartAfterProcessExit(stopReasonForRestart)) {
      if (
        stopReasonForRestart === 'user.stop' ||
        stopReasonForRestart === 'platform.team_switch' ||
        stopReasonForRestart === 'daemon.shutdown'
      ) {
        this.deps.crashLoop.clear(opts.chatroomId, opts.role);
      }
      return;
    }

    this.maybeRestartAgent(opts, ctx);
  }

  private hasCursorSdkRunErrorInContext(recentLogLines: string[]): boolean {
    if (!isCursorSdkRunErrorInLogs(recentLogLines)) {
      return false;
    }
    console.log(
      `[AgentProcessManager] cursor-sdk run-error detected: ${formatCursorSdkRunErrorMessage(recentLogLines)}`
    );
    return true;
  }

  private maybeRestartAgent(opts: HandleExitOpts, ctx: ExitContext): void {
    const { harness, model, workingDir, recentLogLines } = ctx;
    const logs = recentLogLines ?? [];

    if (!harness || !workingDir) {
      console.log(
        `[AgentProcessManager] ⚠️  Cannot restart — missing harness or workingDir ` +
          `(role: ${opts.role}, harness: ${harness ?? 'none'}, workingDir: ${workingDir ?? 'none'})`
      );
      return;
    }

    if (isPermanentHarnessFailure(logs)) {
      this.handlePermanentFailureForRestart(
        opts,
        recentLogLines,
        ctx.terminalProviderFailureHandled
      );
      return;
    }

    const hadRunError = this.hasCursorSdkRunErrorInContext(logs);

    if (harness === 'cursor-sdk') {
      void this.retryCursorSdkSessionReopen(opts, ctx, hadRunError);
      return;
    }

    void this.ensureRunning({
      chatroomId: opts.chatroomId,
      role: opts.role,
      agentHarness: harness,
      model,
      workingDir,
      reason: 'platform.crash_recovery',
      wantResume: hadRunError ? false : (ctx.wantResume ?? true),
    })
      .then((result) => {
        if (!result.success) {
          console.log(
            `[AgentProcessManager] ⚠️  Agent restart did not complete for ${opts.role}: ${result.error ?? 'unknown'}`
          );
        }
      })
      .catch((err: Error) => {
        console.log(`   ⚠️  Failed to restart agent: ${err.message}`);
        this.emitStartFailedEvent(opts.role, opts.chatroomId, err.message);
      });
  }

  private clearHarnessSessionAfterResumePhaseFailure(
    key: string,
    opts: Pick<HandleExitOpts, 'chatroomId' | 'role'>
  ): void {
    const stored = this.lastHarnessSessions.get(key);
    this.clearLastHarnessSession(key);
    if (stored?.harnessSessionId) {
      notifyNativeSessionLost({
        chatroomId: opts.chatroomId,
        role: opts.role,
        harnessSessionId: stored.harnessSessionId,
      });
    }
  }

  private resolveCursorSdkReopenWantResume(
    hadRunError: boolean,
    attempt: number,
    ctx: ExitContext
  ): boolean {
    if (hadRunError && attempt <= CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS) {
      return true;
    }
    if (hadRunError) {
      return false;
    }
    return ctx.wantResume ?? true;
  }

  // fallow-ignore-next-line complexity
  private async retryCursorSdkSessionReopen(
    opts: HandleExitOpts,
    ctx: ExitContext,
    hadRunError: boolean
  ): Promise<void> {
    const key = agentKey(opts.chatroomId, opts.role);
    if (this.sessionReopenRetryInFlight.has(key)) {
      return;
    }
    this.sessionReopenRetryInFlight.add(key);

    const harness = ctx.harness as AgentHarness;
    const model = ctx.model;
    const workingDir = ctx.workingDir as string;
    let lastError = 'unknown';

    try {
      for (let attempt = 1; attempt <= CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS; attempt++) {
        if (hadRunError && attempt === CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS + 1) {
          this.clearHarnessSessionAfterResumePhaseFailure(key, opts);
        }

        const wantResume = this.resolveCursorSdkReopenWantResume(hadRunError, attempt, ctx);
        const stored = this.lastHarnessSessions.get(key);
        const storedSessionId = stored ? resolveResumableHarnessSessionId(stored) : undefined;

        await this.emitSessionReopenRetry(
          opts.chatroomId,
          opts.role,
          attempt,
          attempt > 1 ? lastError : undefined,
          storedSessionId
        );

        const result = await this.ensureRunning({
          chatroomId: opts.chatroomId,
          role: opts.role,
          agentHarness: harness,
          model,
          workingDir,
          reason: CURSOR_SDK_SESSION_REOPEN_REASON,
          wantResume,
        });

        if (result.success) {
          return;
        }

        lastError = result.error ?? 'unknown';

        if (attempt < CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS) {
          await this.deps.clock.delay(CURSOR_SDK_SESSION_REOPEN_INTERVAL_MS);
        }
      }

      const failureMessage = `cursor-sdk session reopen failed after ${CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS} attempts: ${lastError}`;
      console.log(`[AgentProcessManager] ⛔ ${failureMessage}`);
      this.emitStartFailedEvent(opts.role, opts.chatroomId, failureMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`   ⚠️  cursor-sdk session reopen retry loop failed: ${message}`);
      this.emitStartFailedEvent(opts.role, opts.chatroomId, message);
    } finally {
      this.sessionReopenRetryInFlight.delete(key);
    }
  }

  private handlePermanentFailureForRestart(
    opts: HandleExitOpts,
    recentLogLines: string[] | undefined,
    startFailedAlreadyEmitted: boolean
  ): void {
    const error = isTerminalProviderFailureInLogs(recentLogLines ?? [])
      ? formatTerminalProviderFailureMessage(recentLogLines ?? [])
      : formatPermanentHarnessFailureMessage(recentLogLines ?? []);
    console.log(`[AgentProcessManager] ⛔ Skipping restart — ${error}`);
    this.deps.crashLoop.clear(opts.chatroomId, opts.role);
    const key = agentKey(opts.chatroomId, opts.role);
    this.clearLastHarnessSession(key);
    if (startFailedAlreadyEmitted) {
      return;
    }
    this.deps.backend
      .mutation(api.machines.emitAgentStartFailed, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId: opts.chatroomId,
        role: opts.role,
        error,
      })
      .catch((emitErr: Error) => {
        console.log(`   ⚠️  Failed to emit startFailed event: ${emitErr.message}`);
      });
  }

  private emitStartFailedEvent(role: string, chatroomId: string, error: string): void {
    this.deps.backend
      .mutation(api.machines.emitAgentStartFailed, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        error,
      })
      .catch(() => {});
  }

  getSlot(chatroomId: string, role: string): AgentSlot | undefined {
    return this.getSlotFromMirror(chatroomId, role);
  }

  setLastInFlightTask(chatroomId: string, role: string, taskId: string): void {
    const slot = this.getOrCreateSlot(agentKey(chatroomId, role));
    slot.lastInFlightTaskId = taskId;
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

  listAllSlots(): { chatroomId: string; role: string; slot: AgentSlot }[] {
    const result: { chatroomId: string; role: string; slot: AgentSlot }[] = [];
    for (const [key, slot] of this.slots) {
      const [chatroomId, role] = key.split(':');
      result.push({ chatroomId, role, slot });
    }
    return result;
  }

  /** Force-clear slots stuck in stopping beyond STOPPING_TIMEOUT_MS. Returns true if cleared. */
  async clearStuckStoppingSlot(chatroomId: string, role: string): Promise<boolean> {
    const key = agentKey(chatroomId, role);
    const slot = this.slots.get(key);
    if (!slot || slot.state !== 'stopping') {
      return false;
    }
    const elapsed = slot.stoppingSince
      ? this.deps.clock.now() - slot.stoppingSince
      : STOPPING_TIMEOUT_MS;
    if (elapsed < STOPPING_TIMEOUT_MS) {
      return false;
    }
    await this.forceClearStuckStoppingSlot(key, slot, chatroomId, role, 'daemon.stop_timeout');
    console.warn(`[AgentProcessManager] ⚠️ Cleared stuck stopping slot for ${role}@${chatroomId}`);
    return true;
  }

  /** Force-clear every in-memory slot stuck in stopping. Returns count cleared. */
  async clearAllStuckStoppingSlots(): Promise<number> {
    let cleared = 0;
    for (const { chatroomId, role } of this.listAllSlots()) {
      if (await this.clearStuckStoppingSlot(chatroomId, role)) {
        cleared++;
      }
    }
    return cleared;
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
        this.recordAgentExitedOrQueueRetry(
          role,
          exitArgs,
          'Failed to record agent exit on recovery'
        );

        await this.clearAgentPidQuietly(chatroomId, role);
        killed++;
      } else {
        await this.clearAgentPidQuietly(chatroomId, role);
        cleaned++;
      }
    }

    console.log(`[AgentProcessManager] Recovery: ${killed} killed, ${cleaned} cleaned up`);

    const clearedCount = await this.clearAllStuckStoppingSlots();
    if (clearedCount > 0) {
      console.log(`[AgentProcessManager] Recovery: cleared ${clearedCount} stuck stopping slot(s)`);
    }
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
    await this.killInMemorySlotIfAlive(key, chatroomId, role);
    await this.killPersistedProcessIfAlive(chatroomId, role);
  }

  private async killInMemorySlotIfAlive(
    key: string,
    chatroomId: string,
    role: string
  ): Promise<void> {
    const slot = this.slots.get(key);
    if (
      slot?.pid &&
      isProcessAlive(this.deps.processes.kill, slot.pid) &&
      (slot.state === 'running' || slot.state === 'spawning')
    ) {
      const pid = slot.pid;
      slot.state = 'stopping';
      slot.stoppingSince = this.deps.clock.now();
      await this.doStop(key, slot, pid, { chatroomId, role, reason: 'daemon.respawn' });
    }
  }

  private async killPersistedProcessIfAlive(chatroomId: string, role: string): Promise<void> {
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
      await this.deps.persistence
        .clearAgentPid(this.deps.machineId, chatroomId, role)
        .catch(() => {});
      return;
    }

    const key = agentKey(chatroomId, role);
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
    this.recordAgentExitedOrQueueRetry(
      role,
      exitArgs,
      'Failed to record agent exit before respawn'
    );

    await this.clearAgentPidQuietly(chatroomId, role);
  }

  private async executeEnsureRunning(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts
  ): Promise<OperationResult> {
    try {
      await this.killExistingBeforeSpawn(opts.chatroomId, opts.role);
      const result = await this.doEnsureRunning(key, slot, opts);
      return result;
    } finally {
      if (slot.pendingOperation) {
        slot.pendingOperation = undefined;
      }
    }
  }

  private recordAgentExitedOrQueueRetry(
    role: string,
    exitArgs: RetryQueueItem['args'],
    failureLog: string
  ): void {
    this.deps.backend.mutation(api.machines.recordAgentExited, exitArgs).catch((err: Error) => {
      console.log(`   ⚠️  ${failureLog}: ${err.message}`);
      this.queueExitRetry({ role, args: exitArgs });
    });
  }

  private async clearAgentPidQuietly(chatroomId: string, role: string): Promise<void> {
    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, chatroomId, role);
    } catch {
      // Non-critical
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

  private async tryDaemonMemoryResume(opts: {
    key: string;
    chatroomId: string;
    role: string;
    agentHarness: AgentHarness;
    workingDir: string;
    model?: string;
    initPrompt: string;
    systemPrompt: string;
    service: RemoteAgentService;
  }): Promise<SpawnResult | null> {
    const validationResult = this.validateDaemonMemoryResumePreconditions(opts);
    if (validationResult) {
      return null;
    }

    const stored = this.lastHarnessSessions.get(opts.key);
    if (!stored) {
      return null;
    }
    if (!opts.service.resumeFromDaemonMemory) {
      return null;
    }

    try {
      const resumableId = resolveResumableHarnessSessionId(stored);
      await this.emitSessionResumeRequested(
        opts.chatroomId,
        opts.role,
        opts.agentHarness,
        resumableId
      );
      const spawnResult = await opts.service.resumeFromDaemonMemory(
        {
          workingDir: stored.workingDir,
          prompt: createSpawnPrompt(opts.initPrompt),
          systemPrompt: opts.systemPrompt,
          model: opts.model ?? stored.model,
          context: {
            machineId: this.deps.machineId,
            chatroomId: opts.chatroomId,
            role: opts.role,
          },
          resolvedConvexUrl: this.deps.convexUrl,
        },
        {
          harnessSessionId: resumableId,
          agentName: stored.agentName,
          workingDir: stored.workingDir,
          model: stored.model,
        }
      );
      await this.emitSessionResumed(opts.chatroomId, opts.role, resumableId);
      return spawnResult;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.clearLastHarnessSession(opts.key);
      await this.emitSessionResumeFailed(
        opts.chatroomId,
        opts.role,
        reason,
        resolveResumableHarnessSessionId(stored)
      );
      return null;
    }
  }

  private validateDaemonMemoryResumePreconditions(opts: {
    key: string;
    chatroomId: string;
    role: string;
    agentHarness: AgentHarness;
    workingDir: string;
    service: RemoteAgentService;
  }): string | null {
    const stored = this.lastHarnessSessions.get(opts.key);
    if (!stored) {
      return null;
    }

    if (stored.workingDir !== opts.workingDir) {
      this.clearLastHarnessSession(opts.key);
      this.emitSessionResumeFailed(
        opts.chatroomId,
        opts.role,
        'working directory changed',
        resolveResumableHarnessSessionId(stored)
      );
      return 'working directory changed';
    }

    if (stored.harness !== opts.agentHarness || !stored.agentName) {
      this.clearLastHarnessSession(opts.key);
      this.emitSessionResumeFailed(
        opts.chatroomId,
        opts.role,
        stored.harness !== opts.agentHarness
          ? 'harness changed'
          : 'incomplete session in daemon memory',
        resolveResumableHarnessSessionId(stored)
      );
      return 'validation failed';
    }

    if (!opts.service.resumeFromDaemonMemory) {
      this.emitSessionResumeFailed(
        opts.chatroomId,
        opts.role,
        'daemon-memory session resume not yet supported',
        resolveResumableHarnessSessionId(stored)
      );
      return 'not supported';
    }

    return null;
  }

  private async emitSessionResumeRequested(
    chatroomId: string,
    role: string,
    agentHarness: AgentHarness,
    harnessSessionId?: string
  ): Promise<void> {
    try {
      await this.deps.backend.mutation(api.machines.emitSessionResumeRequested, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        agentHarness,
        ...(harnessSessionId ? { harnessSessionId } : {}),
      });
      console.log(`[AgentProcessManager] ✅ Emitted agent.sessionResumeRequested for ${role}`);
    } catch (err) {
      console.log(`   ⚠️  Failed to emit sessionResumeRequested event: ${(err as Error).message}`);
    }
  }

  private async emitSessionResumed(
    chatroomId: string,
    role: string,
    harnessSessionId?: string
  ): Promise<void> {
    try {
      await this.deps.backend.mutation(api.machines.emitSessionResumed, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        ...(harnessSessionId ? { harnessSessionId } : {}),
      });
      console.log(`[AgentProcessManager] ✅ Emitted agent.sessionResumed for ${role}`);
    } catch (err) {
      console.log(`   ⚠️  Failed to emit sessionResumed event: ${(err as Error).message}`);
    }
  }

  private async emitSessionResumeFailed(
    chatroomId: string,
    role: string,
    reason: string,
    harnessSessionId?: string
  ): Promise<void> {
    try {
      await this.deps.backend.mutation(api.machines.emitSessionResumeFailed, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        reason,
        ...(harnessSessionId ? { harnessSessionId } : {}),
      });
      console.log(`[AgentProcessManager] ✅ Emitted agent.sessionResumeFailed for ${role}`);
    } catch (err) {
      console.log(`   ⚠️  Failed to emit sessionResumeFailed event: ${(err as Error).message}`);
    }
  }

  private async emitSessionReopenRetry(
    chatroomId: string,
    role: string,
    attempt: number,
    error?: string,
    harnessSessionId?: string
  ): Promise<void> {
    try {
      await this.deps.backend.mutation(api.machines.emitSessionReopenRetry, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        attempt,
        maxAttempts: CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS,
        ...(error ? { error } : {}),
        ...(harnessSessionId ? { harnessSessionId } : {}),
      });
      console.log(
        `[AgentProcessManager] ✅ Emitted agent.sessionReopenRetry for ${role} (attempt ${attempt}/${CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS})`
      );
    } catch (err) {
      console.log(`   ⚠️  Failed to emit sessionReopenRetry event: ${(err as Error).message}`);
    }
  }

  private applyHarnessSessionIdUpdate(
    key: string,
    slot: AgentSlot,
    chatroomId: string,
    role: string,
    info: HarnessSessionIdUpdatedInfo
  ): void {
    if (!slot.harnessSessionId || slot.harnessSessionId !== info.correlationId) {
      return;
    }
    slot.resumableHarnessSessionId = info.resumableId;
    const stored = this.lastHarnessSessions.get(key);
    if (stored?.harnessSessionId === info.correlationId) {
      this.recordLastHarnessSession(key, {
        ...stored,
        resumableHarnessSessionId: info.resumableId,
      });
    }
    void this.emitHarnessSessionIdUpdated(chatroomId, role, info);
  }

  private async emitHarnessSessionIdUpdated(
    chatroomId: string,
    role: string,
    info: HarnessSessionIdUpdatedInfo
  ): Promise<void> {
    try {
      await this.deps.backend.mutation(api.machines.emitHarnessSessionIdUpdated, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        correlationId: info.correlationId,
        ...(info.previousResumableId ? { previousResumableId: info.previousResumableId } : {}),
        resumableId: info.resumableId,
        source: info.source,
      });
    } catch (err) {
      console.log(`   ⚠️  Failed to emit harnessSessionIdUpdated event: ${(err as Error).message}`);
    }
  }

  private resetSlotIdle(slot: AgentSlot): void {
    slot.state = 'idle';
    slot.pendingOperation = undefined;
  }

  private checkRateLimitGate(opts: EnsureRunningOpts, slot: AgentSlot): OperationResult | null {
    const spawnCheck = this.deps.spawning.shouldAllowSpawn(opts.chatroomId, opts.reason);
    if (!spawnCheck.allowed) {
      this.resetSlotIdle(slot);
      return { success: false, error: 'rate_limited' };
    }
    return null;
  }

  private checkCrashLoopGate(opts: EnsureRunningOpts, slot: AgentSlot): OperationResult | null {
    if (opts.reason !== 'platform.crash_recovery') {
      return null;
    }

    const loopCheck = this.deps.crashLoop.record(opts.chatroomId, opts.role, this.deps.clock.now());
    if (loopCheck.allowed) {
      return null;
    }

    if (loopCheck.waitMs !== undefined && loopCheck.waitMs > 0) {
      console.log(`   ⏳ Agent restart backoff: waiting ${loopCheck.waitMs}ms before retry`);
      this.resetSlotIdle(slot);
      return { success: false, error: 'backoff' };
    }

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

    this.resetSlotIdle(slot);
    return { success: false, error: 'crash_loop' };
  }

  private async validateWorkingDirGate(
    opts: EnsureRunningOpts,
    slot: AgentSlot
  ): Promise<OperationResult | null> {
    try {
      const dirStat = await this.deps.fs.stat(opts.workingDir);
      if (!dirStat.isDirectory()) {
        this.resetSlotIdle(slot);
        return {
          success: false,
          error: `Working directory is not a directory: ${opts.workingDir}`,
        };
      }
    } catch {
      this.resetSlotIdle(slot);
      return { success: false, error: `Working directory does not exist: ${opts.workingDir}` };
    }
    return null;
  }

  private async fetchInitPromptResult(
    opts: EnsureRunningOpts,
    slot: AgentSlot
  ): Promise<
    | { ok: true; initialMessage: string; rolePrompt: string }
    | { ok: false; result: OperationResult }
  > {
    let initPromptResult;
    try {
      initPromptResult = await this.deps.backend.query(api.messages.getInitPrompt, {
        sessionId: this.deps.sessionId,
        chatroomId: opts.chatroomId,
        role: opts.role,
        convexUrl: this.deps.convexUrl,
      });
    } catch (e) {
      this.resetSlotIdle(slot);
      return {
        ok: false,
        result: { success: false, error: `Failed to fetch init prompt: ${(e as Error).message}` },
      };
    }

    if (!initPromptResult?.prompt) {
      this.resetSlotIdle(slot);
      return {
        ok: false,
        result: { success: false, error: 'Failed to fetch init prompt from backend' },
      };
    }

    return {
      ok: true,
      initialMessage: initPromptResult.initialMessage,
      rolePrompt: initPromptResult.rolePrompt,
    };
  }

  private async spawnAgentForEnsureRunning(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts,
    initPrompt: { initialMessage: string; rolePrompt: string },
    wantResume: boolean
  ): Promise<{ ok: true; spawnResult: SpawnResult } | { ok: false; result: OperationResult }> {
    const service = this.deps.agentServices.get(opts.agentHarness);
    if (!service) {
      this.resetSlotIdle(slot);
      return {
        ok: false,
        result: { success: false, error: `Unknown agent harness: ${opts.agentHarness}` },
      };
    }

    let spawnResult: SpawnResult | undefined;
    const resumePath = decideResumePathOnRestart({
      supportsDaemonMemoryResume: typeof service.resumeFromDaemonMemory === 'function',
      wantResume,
      hasStoredSnapshot: this.lastHarnessSessions.has(key),
    });
    if (resumePath === 'daemon_memory') {
      spawnResult =
        (await this.tryDaemonMemoryResume({
          key,
          chatroomId: opts.chatroomId,
          role: opts.role,
          agentHarness: opts.agentHarness,
          workingDir: opts.workingDir,
          model: opts.model,
          initPrompt: initPrompt.initialMessage,
          systemPrompt: initPrompt.rolePrompt,
          service,
        })) ?? undefined;
    }

    if (!spawnResult) {
      const { deferInitialTurn, prompt } = resolveNativeSpawnPolicy(
        opts.agentHarness,
        initPrompt.initialMessage
      );
      try {
        spawnResult = await service.spawn({
          workingDir: opts.workingDir,
          prompt,
          systemPrompt: initPrompt.rolePrompt,
          model: opts.model,
          context: {
            machineId: this.deps.machineId,
            chatroomId: opts.chatroomId,
            role: opts.role,
          },
          resolvedConvexUrl: this.deps.convexUrl,
          deferInitialTurn,
        });
      } catch (e) {
        this.resetSlotIdle(slot);
        return {
          ok: false,
          result: { success: false, error: `Failed to spawn agent: ${(e as Error).message}` },
        };
      }
    }

    return { ok: true, spawnResult };
  }

  private assignRunningSlotState(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts,
    spawnResult: SpawnResult,
    wantResume: boolean,
    pid: number
  ): void {
    slot.state = 'running';
    slot.pid = pid;
    slot.harness = opts.agentHarness;
    slot.harnessSessionId = spawnResult.harnessSessionId;
    slot.resumableHarnessSessionId = undefined;
    if (spawnResult.harnessSessionId) {
      this.recordLastHarnessSession(key, {
        harnessSessionId: spawnResult.harnessSessionId,
        resumableHarnessSessionId: undefined,
        harness: opts.agentHarness,
        agentName: spawnResult.harnessReconnect?.agentName ?? '',
        workingDir: opts.workingDir,
        model: opts.model ?? spawnResult.harnessReconnect?.model,
      });
    }
    slot.model = opts.model;
    slot.wantResume = wantResume;
    slot.workingDir = opts.workingDir;
    slot.startedAt = this.deps.clock.now();
    slot.pendingOperation = undefined;
    slot.recentLogLines = [];
    this.deps.resumeStormTracker.reset(opts.chatroomId, opts.role);
  }

  private emitSpawnedAgentUpdate(
    opts: EnsureRunningOpts,
    spawnResult: SpawnResult,
    pid: number
  ): void {
    this.deps.backend
      .mutation(api.machines.updateSpawnedAgent, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId: opts.chatroomId,
        role: opts.role,
        pid,
        model: opts.model,
        reason: opts.reason,
        ...(spawnResult.harnessSessionId ? { harnessSessionId: spawnResult.harnessSessionId } : {}),
      })
      .catch((err: Error) => {
        console.log(`   ⚠️  Failed to update PID in backend: ${err.message}`);
      });
  }

  private registerSpawnCallbacks(
    slot: AgentSlot,
    opts: EnsureRunningOpts,
    spawnResult: SpawnResult,
    pid: number
  ): void {
    if (spawnResult.onLogLine) {
      spawnResult.onLogLine((line) => appendRecentLogLine(slot, line));
    }

    spawnResult.onExit(({ code, signal }) => {
      void this.handleExit({
        chatroomId: opts.chatroomId,
        role: opts.role,
        pid,
        code,
        signal,
      });
    });

    if (spawnResult.onAgentEnd) {
      spawnResult.onAgentEnd(() => {
        this.turnEndQueue.enqueue(() =>
          this.runHandleAgentEnd({
            chatroomId: opts.chatroomId,
            role: opts.role,
            pid,
            harness: opts.agentHarness,
          })
        );
      });
    }

    if (spawnResult.onHarnessSessionIdUpdated) {
      spawnResult.onHarnessSessionIdUpdated((info) => {
        const slotKey = agentKey(opts.chatroomId, opts.role);
        this.applyHarnessSessionIdUpdate(slotKey, slot, opts.chatroomId, opts.role, info);
      });
    }

    let lastReportedTokenAt = 0;
    spawnResult.onOutput(() => {
      const now = this.deps.clock.now();
      if (lastReportedTokenAt === 0 || now - lastReportedTokenAt >= 30_000) {
        lastReportedTokenAt = now;
        this.deps.backend
          .mutation(api.participants.updateTokenActivity, {
            sessionId: this.deps.sessionId,
            chatroomId: opts.chatroomId,
            role: opts.role,
          })
          .catch(() => {});
      }
    });
  }

  private async finalizeRunningSlot(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts,
    spawnResult: SpawnResult,
    wantResume: boolean
  ): Promise<void> {
    const { pid } = spawnResult;

    this.assignRunningSlotState(key, slot, opts, spawnResult, wantResume, pid);
    this.emitSpawnedAgentUpdate(opts, spawnResult, pid);

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

    this.registerSpawnCallbacks(slot, opts, spawnResult, pid);
    await this.emitNativeWaiting(opts.chatroomId, opts.role, opts.agentHarness);
  }

  private async emitNativeWaiting(
    chatroomId: string,
    role: string,
    harness: AgentHarness
  ): Promise<boolean> {
    if (!getHarnessCapabilities(harness).supportsNativeIntegration) return false;

    try {
      await this.deps.backend.mutation(api.participants.join, {
        sessionId: this.deps.sessionId,
        chatroomId,
        role,
        action: NATIVE_WAITING_ACTION,
      });
      return true;
    } catch (err) {
      console.log(`   ⚠️  Failed to emit native:waiting for ${role}: ${(err as Error).message}`);
      return false;
    }
  }

  private async doEnsureRunning(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts
  ): Promise<OperationResult> {
    slot.state = 'spawning';
    const wantResume = opts.wantResume;

    console.log(
      `[AgentProcessManager] harness start: role=${opts.role} harness=${opts.agentHarness} wantResume=${wantResume} reason=${opts.reason}`
    );

    try {
      const rateLimit = this.checkRateLimitGate(opts, slot);
      if (rateLimit) return rateLimit;

      const crashLoop = this.checkCrashLoopGate(opts, slot);
      if (crashLoop) return crashLoop;

      const workingDir = await this.validateWorkingDirGate(opts, slot);
      if (workingDir) return workingDir;

      const initPrompt = await this.fetchInitPromptResult(opts, slot);
      if (!initPrompt.ok) return initPrompt.result;

      const spawn = await this.spawnAgentForEnsureRunning(key, slot, opts, initPrompt, wantResume);
      if (!spawn.ok) return spawn.result;

      await this.finalizeRunningSlot(key, slot, opts, spawn.spawnResult, wantResume);
      return { success: true, pid: spawn.spawnResult.pid };
    } catch (e) {
      this.resetSlotIdle(slot);
      return { success: false, error: `Unexpected error: ${(e as Error).message}` };
    }
  }

  private recordLastHarnessSession(key: string, ctx: HarnessSessionSnapshot): void {
    this.lastHarnessSessions.set(key, ctx);
  }

  private clearLastHarnessSession(key: string): void {
    this.lastHarnessSessions.delete(key);
  }

  private readHarnessReconnectMetadata(
    service: RemoteAgentService,
    pid: number
  ): HarnessReconnectMetadata | undefined {
    return service.getHarnessReconnectContext?.(pid);
  }

  private shouldPreserveHarnessOnStop(slot: AgentSlot, opts: StopOpts): boolean {
    const harness = slot.harness;
    const service = harness ? this.deps.agentServices.get(harness) : undefined;
    const supportsDaemonMemoryResume = typeof service?.resumeFromDaemonMemory === 'function';
    return shouldPreserveHarnessTeardown(
      opts.reason,
      supportsDaemonMemoryResume,
      Boolean(slot.harnessSessionId)
    );
  }

  private recordHarnessSessionOnStop(
    key: string,
    slot: AgentSlot,
    pid: number,
    service: RemoteAgentService | undefined
  ): void {
    const harness = slot.harness as AgentHarness;
    const harnessMeta = service ? this.readHarnessReconnectMetadata(service, pid) : undefined;
    this.recordLastHarnessSession(key, {
      harnessSessionId: slot.harnessSessionId as string,
      resumableHarnessSessionId: slot.resumableHarnessSessionId,
      harness,
      agentName: harnessMeta?.agentName ?? '',
      workingDir: slot.workingDir ?? '',
      model: slot.model ?? harnessMeta?.model,
    });
  }

  private updateHarnessSessionOnStop(
    key: string,
    slot: AgentSlot,
    pid: number,
    service: RemoteAgentService | undefined,
    preserveForResume: boolean
  ): void {
    const harness = slot.harness;
    if (harness && slot.harnessSessionId) {
      if (preserveForResume) {
        this.recordHarnessSessionOnStop(key, slot, pid, service);
      } else {
        this.clearLastHarnessSession(key);
      }
      return;
    }

    if (!preserveForResume) {
      this.clearLastHarnessSession(key);
    }
  }

  private preserveOrClearHarnessSessionOnStop(
    key: string,
    slot: AgentSlot,
    pid: number,
    opts: StopOpts,
    service: RemoteAgentService | undefined
  ): boolean {
    const preserveForResume = this.shouldPreserveHarnessOnStop(slot, opts);
    this.updateHarnessSessionOnStop(key, slot, pid, service, preserveForResume);
    return preserveForResume;
  }

  private async killProcessWithFallback(pid: number): Promise<void> {
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
          break;
        }
      }
    }

    for (const svc of this.deps.agentServices.values()) {
      svc.untrack(pid);
    }
  }

  private resetSlotAfterStop(slot: AgentSlot): void {
    slot.state = 'idle';
    slot.pid = undefined;
    slot.startedAt = undefined;
    slot.pendingOperation = undefined;
    slot.stoppingSince = undefined;
  }

  private async forceClearStuckStoppingSlot(
    key: string,
    slot: AgentSlot,
    chatroomId: string,
    role: string,
    reason: 'daemon.stop_timeout'
  ): Promise<void> {
    const pid = slot.pid;
    const harness = slot.harness;
    const durationMs = slot.stoppingSince
      ? this.deps.clock.now() - slot.stoppingSince
      : STOPPING_TIMEOUT_MS;

    this.clearSlotRuntimeState(slot);

    void this.deps.backend
      .mutation(api.machines.emitAgentStopTimeout, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        pid,
        durationMs,
      })
      .catch((err: Error) => {
        console.log(`   ⚠️  Failed to emit agent.stopTimeout event: ${err.message}`);
      });

    if (pid) {
      try {
        this.deps.processes.kill(-pid, 'SIGKILL');
      } catch {
        // already dead
      }
      const exitArgs = {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        pid,
        stopReason: reason,
        exitCode: undefined as number | undefined,
        signal: 'SIGKILL' as const,
        agentHarness: harness,
      };
      this.recordAgentExitedOrQueueRetry(role, exitArgs, 'Failed to record stop-timeout exit');
    }
    await this.clearAgentPidQuietly(chatroomId, role);
  }

  private recordStopExit(slot: AgentSlot, pid: number, opts: StopOpts): void {
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
  }

  private async doStop(
    key: string,
    slot: AgentSlot,
    pid: number,
    opts: StopOpts
  ): Promise<OperationResult> {
    try {
      const harness = slot.harness;
      const service = harness ? this.deps.agentServices.get(harness) : undefined;
      const preserveForResume = this.preserveOrClearHarnessSessionOnStop(
        key,
        slot,
        pid,
        opts,
        service
      );

      if (service) {
        await service.stop(pid, { preserveForResume });
        service.untrack(pid);
      } else {
        await this.killProcessWithFallback(pid);
      }
    } catch {
      // Process cleanup is best-effort
    }

    this.resetSlotAfterStop(slot);
    this.recordStopExit(slot, pid, opts);

    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, opts.chatroomId, opts.role);
    } catch {
      // Non-critical
    }

    return { success: true };
  }
}
