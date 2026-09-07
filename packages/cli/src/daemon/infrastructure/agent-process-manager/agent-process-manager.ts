// fallow-ignore-file complexity code-duplication
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AgentProcessManager — single authority for agent lifecycle management.
 *
 * Owns all state transitions, PID tracking, process spawning/killing,
 * rate limiting, and backend event emission.
 *
 * Phase 3: Facade over AgentLifecycleService. Slot state machine (Ref,
 * transitions, spawn/stop/exit brackets, restart decisions) is delegated
 * to AgentLifecycleService. APM retains: killExistingBeforeSpawn,
 * fs validation, init-prompt fetch, daemon-memory resume,
 * lifecycle outbox enqueue and local event logging (spawned/exited facts, etc.),
 * turn-end queue, and exit retry queue.
 *
 * State model per (chatroomId, role):
 *   idle → spawning → running → idle (on exit)
 *                  ↘ idle (on failure)
 *   running → stopping → idle (on stop)
 *
 * Phase 1: standalone, no caller changes. Built and tested in isolation.
 */

import { isExplicitDaemonStart } from '@workspace/backend/src/domain/entities/agent.js';
import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';
import { Effect } from 'effect';

import { isChatroomStopScopeActive } from './execute-stop-targets-adapter.js';
import { buildStopTargetDescriptor, runConfirmedStop } from './stop-agent-confirmed-adapter.js';
import type { ConfirmedStopAdapterDeps } from './stop-agent-confirmed-adapter.js';
import { createTurnCompletedBackend } from './turn-completed-backend.js';
import { api } from '../../../api.js';
import { isProcessAlive } from '../../../infrastructure/deps/process.js';
import type { AgentLogSink } from '../../../infrastructure/log-server/index.js';
import { RapidResumeTracker } from '../../../infrastructure/machine/rapid-resume-tracker.js';
import type { AgentHarness } from '../../../infrastructure/machine/types.js';
import { type AgentLifecyclePortAdapterDeps } from '../../../infrastructure/services/agent-lifecycle/agent-lifecycle-port-adapters.js';
import type { AgentLifecycleRuntime } from '../../../infrastructure/services/agent-lifecycle/agent-lifecycle-runtime.js';
import { createAgentLifecycleRuntime } from '../../../infrastructure/services/agent-lifecycle/agent-lifecycle-runtime.js';
import {
  AgentLifecycleService,
  type AgentLifecycleSlot,
  type EnsureRunningOpts,
  type HandleExitOpts,
  type OperationResult,
  type StopOpts,
} from '../../../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';
import type { Signals } from '../../../infrastructure/types/signals.js';
import {
  buildAgentLifecycleRevisionKey,
  buildExitedLifecycleFact,
  type AgentExitAuditArgs,
  type AgentLifecycleFact,
} from '../../domain/entities/agent-lifecycle-fact.js';
import { AgentStopError } from '../../domain/entities/agent-stop.js';
import type {
  AgentStopTargetDescriptor,
  AgentStopReason,
} from '../../domain/entities/agent-stop.js';
import { resolveStopReason } from '../../domain/entities/stop-reason.js';
import type { StopReason } from '../../domain/entities/stop-reason.js';
import { resolveNativeSpawnPolicy } from '../../domain/native-integration/spawn-policy.js';
import { appendRecentLogLine } from '../../domain/usecase/append-recent-log-line.js';
import {
  classifyProviderErrorFromLogs,
  hasHarnessOutputStalled,
} from '../../domain/usecase/classify-provider-error.js';
import {
  handleTurnCompleted,
  type ResumeStormTracker,
} from '../../domain/usecase/handle-turn-completed.js';
import { untrackChildPid } from '../../entry/handlers/orphan-tracker.js';
import { getNativeDeliverySession } from '../../entry/native-delivery/native-delivery-session-registry.js';
import { notifyNativeHarnessSessionLostOnExit } from '../../entry/native-delivery/native-harness-session-exit.js';
import {
  getNativeTaskDeliveryCoordinator,
  notifyNativeTurnIdle,
} from '../../entry/native-delivery/native-task-delivery-coordinator.js';
import {
  defaultNativeTurnPhase,
  setNativeTurnPhase,
  type NativeTurnPhase,
} from '../../entry/native-delivery/native-turn-phase.js';
import { logDaemonAuditEvent } from '../event-stream/daemon-event-emitter.js';
import {
  emitNativeWaitingAfterSpawn,
  wireTokenActivityReporting,
} from '../local/harness/services/native-spawn-presence.js';
import type {
  AgentLogLine,
  HarnessReconnectMetadata,
  RemoteAgentService,
  SpawnResult,
} from '../local/harness/services/remote-agent-service.js';
import type { AgentLifecycleOutboxResult } from '../outbox/agent-lifecycle-outbox.js';

// ─── Types ────────────────────────────────────────────────────────────────────

// Re-exported from AgentLifecycleService — authoritative definitions.
// APM uses these for its imperative (async/await) public API.
export type {
  OperationResult,
  EnsureRunningOpts,
  StopOpts,
  HandleExitOpts,
} from '../../../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';
export type { NativeTurnPhase } from '../../entry/native-delivery/native-turn-phase.js';

export type AgentSlotState = 'idle' | 'spawning' | 'running' | 'stopping';

type AgentProcessManagerResetInput =
  | { readonly scope: 'chatroom'; readonly chatroomId: string }
  | { readonly scope: 'chatroom-role'; readonly chatroomId: string; readonly role: string };

interface ExitContext {
  harness: AgentHarness | undefined;
  model: string | undefined;
  workingDir: string | undefined;
  harnessSessionId: string | undefined;
  recentLogLines: string[] | undefined;
  stopReason: StopReason;
  terminalProviderFailureHandled: boolean;
}

/** APM's internal slot — mirrors AgentLifecycleSlot with imperative-compatible fields. */
export interface AgentSlot {
  state: AgentSlotState;
  pid?: number | undefined;
  harness?: AgentHarness | undefined;
  /** Immutable spawn correlation ID for native delivery gating and ledger. */
  harnessSessionId?: string | undefined;
  model?: string | undefined;
  workingDir?: string | undefined;
  startedAt?: number | undefined;
  /** Promise that resolves when a pending spawn or stop completes */
  pendingOperation?: Promise<OperationResult> | undefined;
  /** Recent harness log lines for resume-storm reason classification. */
  recentLogLines?: string[] | undefined;
  /** User's persisted reconnect-on-start preference for this run. */
  wantResume?: boolean | undefined;
  authorizedLifecycleRevision?: number | undefined;
  /** Turn-end already emitted startFailed for a terminal provider error. */
  terminalProviderFailureHandled?: boolean | undefined;
  /** Provider-unavailable event already emitted for this spawn. */
  providerUnavailableEmitted?: boolean | undefined;
  lastOutputAt?: number | undefined;
  /** Task last delivered to this native harness slot — sent on agent_end. */
  /** Native harness turn lifecycle — delivery control plane (not UI participant state). */
  nativeTurnPhase?: NativeTurnPhase | undefined;
  /** When the slot entered stopping — used to detect hung stop. */
  stoppingSince?: number | undefined;
  /** Monotonic token for the current stop attempt — bumped on stop claim and force-clear. */
  stopGeneration?: number | undefined;
  /** Stop intent remains set after the process is gone until an explicit start clears it. */
  stopRequested?: boolean | undefined;
  /** Expected process exit metadata for distinguishing intentional termination. */
  expectedStopReason?: string | undefined;
  expectedStopPid?: number | undefined;
  /** Backend stop command/target currently responsible for this stopping slot. */
  stopCommandId?: string | undefined;
  stopTargetKey?: string | undefined;
}

export interface AgentProcessManagerDeps {
  lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<AgentLifecycleOutboxResult> };
  logEvent: (event: Record<string, unknown>) => Promise<void>;
  logSink?: AgentLogSink | undefined;
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
    ) => { allowed: boolean; retryAfterMs?: number | undefined };
  };
  convexUrl: string;
  resumeStormTracker?: ResumeStormTracker | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

// ─── Retry Queue Types ────────────────────────────────────────────────────────

/** Arguments for a queued agent.exited log event that failed and needs retry. */
interface RetryQueueItem {
  role: string;
  args: AgentExitAuditArgs;
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

  /** Active multi-attempt session recovery loops per chatroom+role. */
  /** Queue of failed agent.exited log events awaiting retry. */
  private readonly exitRetryQueue: RetryQueueItem[] = [];
  /** Active retry interval timer handle, or null if queue is empty. */
  private exitRetryTimer: ReturnType<typeof setInterval> | null = null;
  private agentEndEventSequence = 0;
  /** Shared per-agent serialization boundary for public and internal operations. */
  private readonly serializedOperationTails = new Map<string, Promise<void>>();
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

  runSerializedForAgent<T>(
    key: { chatroomId: string; role: string },
    operation: () => Promise<T>
  ): Promise<T> {
    const serializedKey = agentKey(key.chatroomId, key.role);
    const previous = this.serializedOperationTails.get(serializedKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(
      () => undefined,
      () => undefined
    );
    this.serializedOperationTails.set(serializedKey, tail);
    void tail.finally(() => {
      if (this.serializedOperationTails.get(serializedKey) === tail) {
        this.serializedOperationTails.delete(serializedKey);
      }
    });
    return current;
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
    return (async () => {
      while (this.serializedOperationTails.size > 0) {
        await Promise.all([...this.serializedOperationTails.values()]);
      }
    })();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  private clearSlotRuntimeState(slot: AgentSlot): void {
    slot.state = 'idle';
    slot.pid = undefined;
    slot.harness = undefined;
    slot.harnessSessionId = undefined;
    slot.model = undefined;
    slot.workingDir = undefined;
    slot.startedAt = undefined;
    slot.pendingOperation = undefined;
    slot.stoppingSince = undefined;
    slot.stopCommandId = undefined;
    slot.stopTargetKey = undefined;
    slot.nativeTurnPhase = undefined;
  }

  private bumpStopGeneration(slot: AgentSlot): number {
    slot.stopGeneration = (slot.stopGeneration ?? 0) + 1;
    return slot.stopGeneration;
  }

  /** Claim stop intent before asynchronous termination begins. */
  public markStopIntent(chatroomId: string, role: string, reason: string, pid?: number): number {
    const slot = this.getOrCreateSlot(agentKey(chatroomId, role));
    if (slot.stopRequested) return slot.stopGeneration ?? 0;
    const generation = this.bumpStopGeneration(slot);
    slot.stopRequested = true;
    slot.expectedStopReason = reason;
    slot.expectedStopPid = pid;
    return generation;
  }

  /** Claim stop intent for all currently known agents in a chatroom. */
  public markChatroomStopIntent(chatroomId: string, reason: string): void {
    for (const { chatroomId: cid, role, slot } of this.listAllSlots()) {
      if (cid === chatroomId) {
        this.markStopIntent(chatroomId, role, reason, slot.pid);
      }
    }
  }

  public isStopRequested(chatroomId: string, role: string, generation?: number): boolean {
    const slot = this.slots.get(agentKey(chatroomId, role));
    if (!slot) return false;
    if (generation !== undefined && slot.stopGeneration !== generation) return true;
    return slot.stopRequested === true;
  }

  private clearStopIntent(slot: AgentSlot): void {
    slot.stopRequested = false;
    slot.expectedStopReason = undefined;
    slot.expectedStopPid = undefined;
  }

  async ensureRunning(opts: EnsureRunningOpts): Promise<OperationResult> {
    if (isChatroomStopScopeActive(opts.chatroomId)) {
      return { success: false, error: 'stop_in_progress' };
    }
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.getOrCreateSlot(key);
    if (isExplicitDaemonStart(opts.reason)) {
      this.bumpStopGeneration(slot);
      this.clearStopIntent(slot);
    } else if (slot.stopRequested) {
      return { success: false, error: 'stop_requested' };
    }
    if (
      slot.state !== 'idle' &&
      opts.lifecycleRevision !== undefined &&
      slot.authorizedLifecycleRevision !== opts.lifecycleRevision
    ) {
      return { success: false, error: 'stale_revision' };
    }

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
    setNativeTurnPhase(slot, 'injecting');
    try {
      await service.resumeTurn(slot.pid, args.prompt);
      setNativeTurnPhase(slot, 'turn_in_flight');
    } catch (err) {
      setNativeTurnPhase(slot, defaultNativeTurnPhase());
      throw err;
    }
  }

  async stop(opts: StopOpts): Promise<{ success: boolean }> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.slots.get(key);

    this.markStopIntent(opts.chatroomId, opts.role, opts.reason, opts.pid ?? slot?.pid);

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

  async discoverStopTargets(chatroomId: string): Promise<AgentStopTargetDescriptor[]> {
    const targets = new Map<string, AgentStopTargetDescriptor>();
    for (const { chatroomId: cid, role, slot } of this.listAllSlots()) {
      if (cid !== chatroomId || !slot.pid || slot.pid <= 0 || !slot.harness) continue;
      const target = buildStopTargetDescriptor({
        machineId: this.deps.machineId,
        chatroomId: cid,
        role,
        pid: slot.pid,
        agentHarness: slot.harness,
      });
      targets.set(target.targetKey, target);
    }
    try {
      for (const { chatroomId: cid, role, entry } of await this.deps.persistence.listAgentEntries(
        this.deps.machineId
      )) {
        if (cid !== chatroomId || !entry.pid || entry.pid <= 0 || !entry.harness) continue;
        const target = buildStopTargetDescriptor({
          machineId: this.deps.machineId,
          chatroomId: cid,
          role,
          pid: entry.pid,
          agentHarness: entry.harness,
        });
        targets.set(target.targetKey, target);
      }
    } catch (error) {
      console.warn(`[daemon] failed to discover stop targets: ${(error as Error).message}`);
    }
    return [...targets.values()];
  }

  getConfirmedStopAdapterDeps(): ConfirmedStopAdapterDeps {
    return {
      machineId: this.deps.machineId,
      sessionId: this.deps.sessionId,
      agentServices: this.deps.agentServices,
      processes: this.deps.processes,
      lifecycleOutbox: this.deps.lifecycleOutbox,
      logEvent: this.deps.logEvent,
      clock: this.deps.clock,
      killProcessWithFallback: this.killProcessWithFallback.bind(this),
    };
  }

  /** Associate a local stopping slot with the durable stop target being executed. */
  bindStopTarget(args: {
    chatroomId: string;
    role: string;
    pid: number;
    stopCommandId: string;
    targetKey: string;
  }): void {
    const slot = this.slots.get(agentKey(args.chatroomId, args.role));
    if (!slot || slot.pid !== args.pid || slot.state !== 'stopping') return;
    slot.stopCommandId = args.stopCommandId;
    slot.stopTargetKey = args.targetKey;
  }

  // fallow-ignore-next-line unused-class-member
  async withScopedRoleStop<T>(
    opts: StopOpts,
    fn: () => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false; reason: 'concurrent' | 'no_slot' }> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.slots.get(key);
    if (!slot || !slot.pid || slot.state === 'idle') return { ok: false, reason: 'no_slot' };
    if (slot.state === 'stopping' || slot.pendingOperation)
      return { ok: false, reason: 'concurrent' };
    this.markStopIntent(opts.chatroomId, opts.role, opts.reason, slot.pid);
    slot.state = 'stopping';
    slot.stoppingSince = this.deps.clock.now();
    try {
      const value = await fn();
      this.resetSlotAfterStop(slot);
      await this.clearAgentPidQuietly(opts.chatroomId, opts.role);
      return { ok: true, value };
    } catch (error) {
      slot.state = 'running';
      throw error;
    }
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
    const stopGeneration = slot.stopGeneration ?? 0;
    slot.stoppingSince = this.deps.clock.now();
    const operation = this.doStop(key, slot, pid, opts, stopGeneration);
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

    const exitArgs = {
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
    this.recordAgentExit(opts.role, exitArgs, 'Failed to record agent exit (idle cleanup)');
  }

  // fallow-ignore-next-line complexity
  private async runHandleAgentEnd(opts: {
    chatroomId: string;
    role: string;
    pid: number;
    harness: AgentHarness;
  }): Promise<void> {
    const slot = this.slots.get(agentKey(opts.chatroomId, opts.role));
    if (
      !slot ||
      slot.pid !== opts.pid ||
      slot.harness !== opts.harness ||
      slot.state !== 'running'
    ) {
      console.log(
        `[AgentProcessManager] Ignoring stale agent_end: role=${opts.role} callbackPid=${opts.pid} currentPid=${slot?.pid ?? 'none'} currentState=${slot?.state ?? 'none'}`
      );
      return;
    }

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
      this.maybeEmitProviderUnavailable(opts.chatroomId, opts.role, slot);

      const taskState = getNativeDeliverySession()?.nativeDelivery?.agentTaskState;
      const activeTask = taskState?.get({
        chatroomId: opts.chatroomId,
        role: opts.role,
      });
      if (taskState && activeTask) {
        const result = await taskState.handleAgentTurnEnded({
          chatroomId: opts.chatroomId,
          role: opts.role,
          version: {
            taskId: activeTask.taskId,
            generation: activeTask.generation,
          },
          eventId: `${opts.pid}:${++this.agentEndEventSequence}`,
        });

        if (result.outcome === 'reminder_requested') {
          console.log(
            `[AgentProcessManager] ⏩ Handoff reminder requested for ${opts.role} (attempt ${result.attempt})`
          );
          return;
        }
        if (result.outcome === 'already_handed_off') {
          setNativeTurnPhase(slot, defaultNativeTurnPhase());
          notifyNativeTurnIdle({ chatroomId: opts.chatroomId, role: opts.role });
          console.log(`[AgentProcessManager] ✅ Native agent_end completed for ${opts.role}`);
          return;
        }
      }
      return;
    }

    const result = await handleTurnCompleted(
      {
        resumeStormTracker: this.deps.resumeStormTracker,
        backend: createTurnCompletedBackend({
          sessionId: this.deps.sessionId,
          machineId: this.deps.machineId,
          logEvent: this.deps.logEvent,
          backend: this.deps.backend,
        }),
        now: () => this.deps.clock.now(),
        killProcess: (pid) => {
          try {
            this.deps.processes.kill(-pid, 'SIGTERM');
          } catch {
            // Process may already be dead
          }
        },
        // runHandleAgentEnd already executes inside the per-agent serialized
        // section. Re-entering that section here would wait on itself.
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

  async handleExit(opts: HandleExitOpts): Promise<void> {
    const key = agentKey(opts.chatroomId, opts.role);
    const slot = this.slots.get(key);

    if (!slot || slot.pid !== opts.pid || slot.state === 'stopping') {
      return;
    }

    if (slot.stopRequested && slot.expectedStopPid === opts.pid) {
      return;
    }

    const stopReason: StopReason = resolveStopReason(opts.code, opts.signal);

    const ctx = this.captureExitContext(slot, opts, stopReason);
    if (slot.harness && getHarnessCapabilities(slot.harness).supportsNativeIntegration) {
      setNativeTurnPhase(slot, defaultNativeTurnPhase());
    }
    this.maybeEmitProviderUnavailable(opts.chatroomId, opts.role, slot);
    if (slot.harness && getHarnessCapabilities(slot.harness).supportsNativeIntegration) {
      notifyNativeHarnessSessionLostOnExit({
        chatroomId: opts.chatroomId,
        role: opts.role,
        harness: ctx.harness,
        harnessSessionId: ctx.harnessSessionId,
      });
    }

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
    void this.emitExitEvent(slot, opts, ctx);
    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, opts.chatroomId, opts.role);
    } catch {
      // Non-critical
    }
    this.untrackAllServices(opts.pid);

    void lifecyclePromise.catch(() => {
      // Lifecycle error — exit bookkeeping has already been recorded.
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
      recentLogLines: slot.recentLogLines,
      stopReason,
      terminalProviderFailureHandled: slot.terminalProviderFailureHandled === true,
    };
  }

  private resetSlotAfterExit(slot: AgentSlot): void {
    slot.state = 'idle';
    slot.pid = undefined;
    slot.startedAt = undefined;
    slot.pendingOperation = undefined;
    slot.nativeTurnPhase = undefined;
  }

  private emitExitEvent(slot: AgentSlot, opts: HandleExitOpts, ctx: ExitContext): Promise<void> {
    const stopReason = ctx.stopReason;
    const exitArgs = {
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
    return this.recordAgentExit(opts.role, exitArgs, 'Failed to record agent exit event');
  }

  private untrackAllServices(pid: number): void {
    for (const service of this.deps.agentServices.values()) {
      service.untrack(pid);
    }
  }

  private maybeEmitProviderUnavailable(
    chatroomId: string,
    role: string,
    slot: AgentSlot | undefined
  ): void {
    if (!slot || slot.harness !== 'codex-sdk' || slot.providerUnavailableEmitted) return;
    if (!hasHarnessOutputStalled(slot.lastOutputAt, this.deps.clock.now())) return;
    const classification = classifyProviderErrorFromLogs(slot.recentLogLines ?? []);
    if (!classification) return;

    slot.providerUnavailableEmitted = true;
    void logDaemonAuditEvent(this.deps.logEvent, {
      type: 'agent.providerUnavailable',
      chatroomId,
      role,
      machineId: this.deps.machineId,
      reason: classification.reason,
      model: slot.model ?? '',
      message: classification.message,
    });
    void this.deps.backend
      .mutation(api.daemon.agentEvents.agentProviderUnavailable, {
        sessionId: this.deps.sessionId,
        machineId: this.deps.machineId,
        chatroomId,
        role,
        reason: classification.reason,
        model: slot.model ?? '',
        message: classification.message,
      })
      .catch(() => {});
  }

  getSlot(chatroomId: string, role: string): AgentSlot | undefined {
    return this.getSlotFromMirror(chatroomId, role);
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
  async clearStuckStoppingSlot(
    chatroomId: string,
    role: string,
    options?: { clearStopIntent?: boolean }
  ): Promise<boolean> {
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
    await this.forceClearStuckStoppingSlot(
      key,
      slot,
      chatroomId,
      role,
      'daemon.stop_timeout',
      options?.clearStopIntent
    );
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

  /**
   * Stop all known agent processes and clear manager/runtime state.
   *
   * Reset is deliberately explicit and destructive to in-memory coordination
   * state: the next command starts from an empty manager rather than inheriting
   * stale slots, session snapshots, or retry work from the previous state.
   */
  async reset(input: AgentProcessManagerResetInput): Promise<void> {
    const roleKey = input.scope === 'chatroom-role' ? input.role.toLowerCase() : undefined;
    const matchesScope = (candidateChatroomId: string, candidateRole: string): boolean =>
      candidateChatroomId === input.chatroomId &&
      (roleKey === undefined || candidateRole.toLowerCase() === roleKey);
    const knownEntries = new Map<
      string,
      { chatroomId: string; role: string; pid: number; harness: AgentHarness }
    >();

    for (const { chatroomId: slotChatroomId, role, slot } of this.listAllSlots()) {
      if (!matchesScope(slotChatroomId, role)) continue;
      if (slot.pid && slot.harness) {
        knownEntries.set(agentKey(slotChatroomId, role), {
          chatroomId: slotChatroomId,
          role,
          pid: slot.pid,
          harness: slot.harness,
        });
      }
    }

    try {
      for (const {
        chatroomId: entryChatroomId,
        role,
        entry,
      } of await this.deps.persistence.listAgentEntries(this.deps.machineId)) {
        if (!matchesScope(entryChatroomId, role)) continue;
        knownEntries.set(agentKey(entryChatroomId, role), {
          chatroomId: entryChatroomId,
          role,
          pid: entry.pid,
          harness: entry.harness,
        });
      }
    } catch {
      // In-memory state can still be reset when persistence is unavailable.
    }

    for (const { chatroomId, role, pid, harness } of knownEntries.values()) {
      await this.stopPersistedProcess(pid, harness);
      await this.clearAgentPidQuietly(chatroomId, role);
    }

    for (let i = this.exitRetryQueue.length - 1; i >= 0; i--) {
      const item = this.exitRetryQueue[i];
      if (item && matchesScope(item.args.chatroomId, item.role)) this.exitRetryQueue.splice(i, 1);
    }
    if (this.exitRetryQueue.length === 0) this.stopExitRetryTimer();
    for (const key of [...this.slots.keys()]) {
      const [keyChatroomId, keyRole] = key.split(':');
      if (matchesScope(keyChatroomId, keyRole)) this.slots.delete(key);
    }
    await this.lifecycle.runPromise(
      Effect.gen(function* () {
        const svc = yield* AgentLifecycleService;
        yield* svc.reset(input);
      })
    );
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
      const stopGeneration = this.bumpStopGeneration(slot);
      slot.stoppingSince = this.deps.clock.now();
      await this.doStop(
        key,
        slot,
        pid,
        { chatroomId, role, reason: 'daemon.respawn' },
        stopGeneration
      );
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
    this.recordAgentExit(role, exitArgs, 'Failed to record agent exit before respawn');

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

  private recordAgentExit(
    role: string,
    exitArgs: AgentExitAuditArgs,
    failureLog: string
  ): Promise<void> {
    void logDaemonAuditEvent(this.deps.logEvent, { type: 'agent.exited', ...exitArgs }).catch(
      (err: Error) => {
        console.log(`   ⚠️  ${failureLog}: ${err.message}`);
        this.queueExitRetry({ role, args: exitArgs });
      }
    );
    const emittedAt = this.deps.clock.now();
    return this.deps.lifecycleOutbox
      .enqueue(buildExitedLifecycleFact(exitArgs, emittedAt))
      .then(() => undefined)
      .catch((err: Error) => {
        console.log(`   ⚠️  Failed to enqueue agent exited lifecycle fact: ${err.message}`);
      });
  }

  private async clearAgentPidQuietly(chatroomId: string, role: string): Promise<void> {
    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, chatroomId, role);
    } catch {
      // Non-critical
    }
  }

  public async syncSlotsAfterScopedStop(result: {
    targets: { target: { chatroomId: string; role: string; pid: number } }[];
  }): Promise<void> {
    for (const { target } of result.targets) {
      const slot = this.slots.get(agentKey(target.chatroomId, target.role));
      if (!slot || slot.pid !== target.pid) continue;
      this.resetSlotAfterStop(slot);
      await this.clearAgentPidQuietly(target.chatroomId, target.role);
    }
  }

  /**
   * Queue a failed agent.exited log event for retry.
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
        await logDaemonAuditEvent(this.deps.logEvent, { type: 'agent.exited', ...item.args });
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
    slot: AgentSlot,
    opts: EnsureRunningOpts,
    initPrompt: { initialMessage: string; rolePrompt: string }
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
    const initialMessage = opts.initPrompt ?? initPrompt.initialMessage;
    const systemPrompt = opts.systemPrompt ?? initPrompt.rolePrompt;
    const { deferInitialTurn, prompt } = resolveNativeSpawnPolicy(
      opts.agentHarness,
      initialMessage
    );
    try {
      spawnResult = await service.spawn({
        workingDir: opts.workingDir,
        prompt,
        systemPrompt,
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
    slot.model = opts.model;
    slot.wantResume = wantResume;
    slot.workingDir = opts.workingDir;
    slot.startedAt = this.deps.clock.now();
    slot.lastOutputAt = slot.startedAt;
    slot.pendingOperation = undefined;
    slot.recentLogLines = [];
    slot.providerUnavailableEmitted = false;
    this.deps.resumeStormTracker.reset(opts.chatroomId, opts.role);
  }

  private emitSpawnedAgentUpdate(
    slot: AgentSlot,
    opts: EnsureRunningOpts,
    spawnResult: SpawnResult,
    pid: number
  ): Promise<void> {
    void logDaemonAuditEvent(this.deps.logEvent, {
      type: 'agent.started',
      chatroomId: opts.chatroomId,
      role: opts.role,
      machineId: this.deps.machineId,
      agentHarness: opts.agentHarness,
      model: opts.model,
      workingDir: opts.workingDir,
      pid,
      reason: opts.reason,
      ...(spawnResult.harnessSessionId ? { harnessSessionId: spawnResult.harnessSessionId } : {}),
    }).catch((err: Error) => {
      console.log(`   ⚠️  Failed to record agent.started event: ${err.message}`);
    });

    const lifecycleRevision = slot.authorizedLifecycleRevision ?? opts.lifecycleRevision;
    if (lifecycleRevision === undefined) {
      this.deps.processes.kill(pid, 'SIGTERM');
      this.resetSlotIdle(slot);
      return Promise.resolve();
    }
    const emittedAt = this.deps.clock.now();
    return this.deps.lifecycleOutbox
      .enqueue({
        kind: 'spawned',
        chatroomId: opts.chatroomId,
        role: opts.role,
        pid,
        model: opts.model,
        reason: opts.reason,
        ...(spawnResult.harnessSessionId ? { harnessSessionId: spawnResult.harnessSessionId } : {}),
        revisionKey: buildAgentLifecycleRevisionKey('spawned', {
          chatroomId: opts.chatroomId,
          role: opts.role,
          pid,
          emittedAt,
        }),
        emittedAt,
        lifecycleRevision,
      })
      .then((result) => {
        if (result.rejectionReason) {
          console.log(`   ⚠️  Spawn rejected by backend: ${result.rejectionReason}`);
          this.deps.processes.kill(pid, 'SIGTERM');
          this.resetSlotIdle(slot);
        }
      })
      .catch((err: Error) =>
        console.log(`   ⚠️  Failed to enqueue agent spawned lifecycle fact: ${err.message}`)
      );
  }

  private registerSpawnCallbacks(
    slot: AgentSlot,
    opts: EnsureRunningOpts,
    spawnResult: SpawnResult,
    pid: number
  ): void {
    if (spawnResult.onLogLine) {
      spawnResult.onLogLine((line) => {
        slot.lastOutputAt = this.deps.clock.now();
        const entry: AgentLogLine = { stream: 'stdout', message: line };
        appendRecentLogLine(slot, entry.message);
        this.deps.logSink?.write({
          timestamp: this.deps.clock.now(),
          level: 'info',
          source: `harness:${opts.agentHarness}`,
          stream: entry.stream,
          message: entry.message,
          metadata: {
            chatroomId: opts.chatroomId,
            role: opts.role,
            pid,
            harness: opts.agentHarness,
          },
        });
      });
    }
    spawnResult.onOutput(() => {
      slot.lastOutputAt = this.deps.clock.now();
    });

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
        void this.runSerializedForAgent(
          { chatroomId: opts.chatroomId, role: opts.role },
          () =>
            this.runHandleAgentEnd({
              chatroomId: opts.chatroomId,
              role: opts.role,
              pid,
              harness: opts.agentHarness,
            })
        ).catch((error: unknown) => {
          console.warn(
            `[AgentProcessManager] turn-end handling failed for ${opts.role}@${opts.chatroomId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      });
    }

    wireTokenActivityReporting({
      backend: this.deps.backend,
      sessionId: this.deps.sessionId,
      chatroomId: opts.chatroomId,
      role: opts.role,
      spawnResult,
      now: () => this.deps.clock.now(),
      activityEmitter: spawnResult.activityEmitter,
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
    await this.emitSpawnedAgentUpdate(slot, opts, spawnResult, pid);

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
    if (getHarnessCapabilities(opts.agentHarness).supportsNativeIntegration) {
      setNativeTurnPhase(slot, defaultNativeTurnPhase());
    }
    await this.emitNativeWaiting(opts.chatroomId, opts.role, opts.agentHarness);
    if (getHarnessCapabilities(opts.agentHarness).supportsNativeIntegration) {
      const coordinator = getNativeTaskDeliveryCoordinator();
      coordinator.tryInjectNextForRole(opts.chatroomId, opts.role);
      queueMicrotask(() => coordinator.tryInjectNextForRole(opts.chatroomId, opts.role));
    }
  }

  private async emitNativeWaiting(
    chatroomId: string,
    role: string,
    harness: AgentHarness
  ): Promise<boolean> {
    return emitNativeWaitingAfterSpawn(
      {
        backend: this.deps.backend,
        sessionId: this.deps.sessionId,
        chatroomId,
        role,
        lifecycleOutbox: this.deps.lifecycleOutbox,
      },
      harness,
      {
        onError: (err) => {
          console.log(`   ⚠️  Failed to emit native:waiting for ${role}: ${err.message}`);
        },
      }
    );
  }

  private async doEnsureRunning(
    key: string,
    slot: AgentSlot,
    opts: EnsureRunningOpts
  ): Promise<OperationResult> {
    slot.state = 'spawning';
    const authorization = await this.deps.backend.mutation(api.machines.authorizeAgentStart, {
      sessionId: this.deps.sessionId,
      machineId: this.deps.machineId,
      chatroomId: opts.chatroomId,
      role: opts.role,
      lifecycleRevision: opts.lifecycleRevision,
      taskId: opts.taskId as any,
    });
    if (!authorization.allowed) {
      this.resetSlotIdle(slot);
      return { success: false, error: authorization.reason };
    }
    slot.authorizedLifecycleRevision = authorization.lifecycleRevision;
    const wantResume = opts.wantResume;

    console.log(
      `[AgentProcessManager] harness start: role=${opts.role} harness=${opts.agentHarness} wantResume=${wantResume} reason=${opts.reason}`
    );

    try {
      const rateLimit = this.checkRateLimitGate(opts, slot);
      if (rateLimit) return rateLimit;

      const workingDir = await this.validateWorkingDirGate(opts, slot);
      if (workingDir) return workingDir;

      const initPrompt = await this.fetchInitPromptResult(opts, slot);
      if (!initPrompt.ok) return initPrompt.result;

      const spawn = await this.spawnAgentForEnsureRunning(slot, opts, initPrompt);
      if (!spawn.ok) return spawn.result;

      await this.finalizeRunningSlot(key, slot, opts, spawn.spawnResult, wantResume);
      return { success: true, pid: spawn.spawnResult.pid };
    } catch (e) {
      this.resetSlotIdle(slot);
      return { success: false, error: `Unexpected error: ${(e as Error).message}` };
    }
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
    reason: 'daemon.stop_timeout',
    clearStopIntent = false
  ): Promise<void> {
    const pid = slot.pid;
    const harness = slot.harness;
    const stopCommandId = slot.stopCommandId;
    const stopTargetKey = slot.stopTargetKey;
    const durationMs = slot.stoppingSince
      ? this.deps.clock.now() - slot.stoppingSince
      : STOPPING_TIMEOUT_MS;

    this.bumpStopGeneration(slot);
    this.clearSlotRuntimeState(slot);
    // Clear the expired intent in the same synchronous transition as the slot.
    // Doing this after awaited cleanup could erase a newer stop request.
    if (clearStopIntent) {
      this.clearStopIntent(slot);
    }

    void logDaemonAuditEvent(this.deps.logEvent, {
      type: 'agent.stopTimeout',
      chatroomId,
      role,
      machineId: this.deps.machineId,
      pid,
      durationMs,
    }).catch((err: Error) => {
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
      this.recordAgentExit(role, exitArgs, 'Failed to record stop-timeout exit');
    }
    if (pid && stopCommandId && stopTargetKey) {
      try {
        await this.deps.backend.mutation(api.agentStops.reportTargetOutcome, {
          sessionId: this.deps.sessionId,
          stopCommandId,
          chatroomId,
          machineId: this.deps.machineId,
          targetKey: stopTargetKey,
          role,
          pid,
          status: 'failed',
          outcome: 'failed',
          termination: 'forced',
          errorMessage: 'Daemon force-cleared a timed-out stop operation',
        });
        await this.deps.backend.mutation(api.agentStops.completeMachineExecution, {
          sessionId: this.deps.sessionId,
          stopCommandId,
          machineId: this.deps.machineId,
          status: 'failed',
          errorMessage: 'Daemon force-cleared a timed-out stop operation',
        });
      } catch (error) {
        console.log(
          `   ⚠️  Failed to finalize timed-out stop for ${role}@${chatroomId}: ${(error as Error).message}`
        );
      }
    }
    await this.clearAgentPidQuietly(chatroomId, role);
  }

  private async doStop(
    key: string,
    slot: AgentSlot,
    pid: number,
    opts: StopOpts,
    stopGeneration: number
  ): Promise<OperationResult> {
    try {
      const harness = slot.harness;

      if (!harness) {
        await this.killProcessWithFallback(pid);
        if (isProcessAlive(this.deps.processes.kill, pid)) return { success: false };
      } else {
        await runConfirmedStop({
          deps: {
            machineId: this.deps.machineId,
            sessionId: this.deps.sessionId,
            agentServices: this.deps.agentServices,
            processes: this.deps.processes,
            lifecycleOutbox: this.deps.lifecycleOutbox,
            logEvent: this.deps.logEvent,
            clock: this.deps.clock,
            killProcessWithFallback: this.killProcessWithFallback.bind(this),
          },
          target: buildStopTargetDescriptor({
            machineId: this.deps.machineId,
            chatroomId: opts.chatroomId,
            role: opts.role,
            pid,
            agentHarness: harness,
          }),
          reason: opts.reason as AgentStopReason,
        });
      }
    } catch (error) {
      if (error instanceof AgentStopError) {
        console.log(`   ⚠️  stop failed (${error.code}): ${error.message}`);
        return { success: false };
      }
      return { success: false };
    }

    if (slot.stopGeneration !== stopGeneration) {
      return { success: true };
    }

    this.resetSlotAfterStop(slot);
    try {
      await this.deps.persistence.clearAgentPid(this.deps.machineId, opts.chatroomId, opts.role);
    } catch {
      // Non-critical
    }

    return { success: true };
  }
}
