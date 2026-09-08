/**
 * Daemon-specific Effect services — wraps DaemonDeps fields that have
 * no existing infrastructure/services/ counterpart.
 *
 * Existing services (do NOT redefine here):
 *   BackendService, ProcessService, ClockService, FsService, SessionService
 *   → infrastructure/services/
 */

import type { Runtime } from 'effect';
import { Context, Effect, Layer, Ref } from 'effect';
import { SCOPE_TARGET_STOP_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';

import { enqueueAgentLifecycleFact } from './agent-lifecycle-outbox-runtime.js';
import type { MachineStateOps, SpawningOps } from './daemon-deps.js';
import type { ConvexClient, SessionId, WorkspaceForSync } from './daemon-types.js';
import type { AgentRequestStopEventPayload } from './events/agent/on-request-stop-agent.js';
import type { DaemonEventBus } from './events/event-bus.js';
import type { ScopedStopExecutionSummary } from './execute-scoped-stop-command.js';
import { executeScopedStopForCommand } from './execute-scoped-stop-command.js';
import { isAgentStopReason } from '../../../../../services/backend/src/domain/entities/agent.js';
import type { BackendOps, FsOps } from '../../infrastructure/deps/index.js';
import type { AgentHarness, MachineConfig } from '../../infrastructure/machine/types.js';
import type { TryConsumeResult } from '../../infrastructure/services/harness-spawning/index.js';
import type { AgentLifecycleFact } from '../domain/entities/agent-lifecycle-fact.js';
import type { AgentStopReason } from '../domain/entities/agent-stop.js';
import type {
  AgentProcessManager,
  AgentProcessSlotView,
  AgentSessionLostHandler,
  AgentStartedHandler,
  AgentTurnEndedHandler,
  EnsureRunningOpts,
  HandleExitOpts,
  OperationResult,
  StopOpts,
} from '../services/agent-process-service/index.js';
import type { RemoteAgentService } from '../infrastructure/local/harness/services/remote-agent-service.js';
import type {
  AgentLifecycleOutboxRegistry,
  AgentLifecycleOutboxResult,
} from '../infrastructure/outbox/agent-lifecycle-outbox.js';
import type { AgentProcessManagerService } from '../services/service-interfaces.js';
import type { TaskService } from '../services/service-interfaces.js';
export { createTaskService, type TaskService } from '../services/service-interfaces.js';

export interface AgentLifecycleOutboxServiceShape {
  enqueue: (fact: AgentLifecycleFact) => Effect.Effect<AgentLifecycleOutboxResult>;
  stopAll: () => Effect.Effect<void>;
}
export class AgentLifecycleOutboxService extends Context.Tag('AgentLifecycleOutboxService')<
  AgentLifecycleOutboxService,
  AgentLifecycleOutboxServiceShape
>() {}
export const AgentLifecycleOutboxServiceLive = (
  registry: AgentLifecycleOutboxRegistry,
  machineId: string
): Layer.Layer<AgentLifecycleOutboxService> =>
  Layer.succeed(AgentLifecycleOutboxService, {
    enqueue: (fact) => Effect.promise(() => enqueueAgentLifecycleFact(registry, machineId, fact)),
    stopAll: () => Effect.promise(() => registry.stopAll()),
  });

// ─── DaemonMachineService ───────────────────────────────────────────────────

/** Effect service wrapping MachineStateOps (PID persistence, event cursor). */
export interface DaemonMachineServiceShape {
  clearAgentPid: (machineId: string, chatroomId: string, role: string) => Effect.Effect<void>;
  persistAgentPid: (
    machineId: string,
    chatroomId: string,
    role: string,
    pid: number,
    harness: AgentHarness
  ) => Effect.Effect<void>;
  listAgentEntries: (
    machineId: string
  ) => Effect.Effect<
    { chatroomId: string; role: string; entry: { pid: number; harness: AgentHarness } }[]
  >;
  persistEventCursor: (machineId: string, lastSeenEventId: string) => Effect.Effect<void>;
  loadEventCursor: (machineId: string) => Effect.Effect<string | null>;
}

// fallow-ignore-next-line unused-export
export class DaemonMachineService extends Context.Tag('DaemonMachineService')<
  DaemonMachineService,
  DaemonMachineServiceShape
>() {}

export const DaemonMachineServiceLive = (ops: MachineStateOps): Layer.Layer<DaemonMachineService> =>
  Layer.succeed(DaemonMachineService, {
    clearAgentPid: (machineId, chatroomId, role) =>
      Effect.promise(() => ops.clearAgentPid(machineId, chatroomId, role)),
    persistAgentPid: (machineId, chatroomId, role, pid, harness) =>
      Effect.promise(() => ops.persistAgentPid(machineId, chatroomId, role, pid, harness)),
    listAgentEntries: (machineId) => Effect.promise(() => ops.listAgentEntries(machineId)),
    persistEventCursor: (machineId, lastSeenEventId) =>
      Effect.promise(() => ops.persistEventCursor(machineId, lastSeenEventId)),
    loadEventCursor: (machineId) => Effect.promise(() => ops.loadEventCursor(machineId)),
  });

// ─── DaemonSpawningService ──────────────────────────────────────────────────

/** Effect service wrapping SpawningOps (rate-limiting). */
export interface DaemonSpawningServiceShape {
  /** Synchronous — returns the decision immediately without suspending. */
  shouldAllowSpawn: (chatroomId: string, reason: string) => TryConsumeResult;
}

// fallow-ignore-next-line unused-export
export class DaemonSpawningService extends Context.Tag('DaemonSpawningService')<
  DaemonSpawningService,
  DaemonSpawningServiceShape
>() {}

export const DaemonSpawningServiceLive = (ops: SpawningOps): Layer.Layer<DaemonSpawningService> =>
  Layer.succeed(DaemonSpawningService, {
    shouldAllowSpawn: (chatroomId, reason) => ops.shouldAllowSpawn(chatroomId, reason),
  });

// ─── DaemonAgentProcessManagerService ───────────────────────────────────────

/** Effect service wrapping AgentProcessManager — precise types from the class. */
export interface DaemonAgentProcessManagerServiceShape {
  executeScopedStopForCommand?:
    | ((args: {
        stopCommandId: string;
        chatroomId: string;
        scope: { kind: 'chatroom' } | { kind: 'agent'; role: string };
        reason: AgentStopReason;
        inboxCommandId: string;
      }) => Effect.Effect<ScopedStopExecutionSummary>)
    | undefined;
  runInboxRoleScopedStop?:
    ((event: AgentRequestStopEventPayload) => Effect.Effect<void>) | undefined;
  runInboxScopedStop?:
    | ((event: {
        commandId?: string | undefined;
        _id?: string | undefined;
        stopCommandId: string;
        chatroomId: string;
        scope: { kind: 'chatroom' } | { kind: 'agent'; role: string };
        reason: string;
        deadline: number;
      }) => Effect.Effect<void>)
    | undefined;
  ensureRunning: (opts: EnsureRunningOpts) => Effect.Effect<OperationResult>;
  stop: (opts: StopOpts) => Effect.Effect<{ success: boolean }>;
  handleExit: (opts: HandleExitOpts) => Effect.Effect<void>;
  /** Synchronous slot lookup — returns undefined when the slot has no entry. */
  getSlot: (chatroomId: string, role: string) => AgentProcessSlotView | undefined;
  listActive: () => { chatroomId: string; role: string; slot: AgentProcessSlotView }[];
  clearStuckStoppingSlot: (
    chatroomId: string,
    role: string,
    options?: { clearStopIntent?: boolean }
  ) => Effect.Effect<boolean>;
  /** Waits until any in-progress agent turn ends and the manager becomes idle. */
  whenTurnEndsIdle: () => Effect.Effect<void>;
  resumeTurnForSlot: (args: {
    chatroomId: string;
    role: string;
    prompt: string;
  }) => Effect.Effect<void>;
  subscribeAgentTurnEnded: (handler: AgentTurnEndedHandler) => () => void;
  subscribeAgentStarted: (handler: AgentStartedHandler) => () => void;
  subscribeAgentSessionLost: (handler: AgentSessionLostHandler) => () => void;
}

export class DaemonAgentProcessManagerService extends Context.Tag(
  'DaemonAgentProcessManagerService'
)<DaemonAgentProcessManagerService, DaemonAgentProcessManagerServiceShape>() {}

export const DaemonAgentProcessManagerServiceLive = (
  mgr: AgentProcessManager,
  processManagerService: AgentProcessManagerService,
  sessionDeps?: {
    sessionId: string;
    machineId: string;
    backend: DaemonSessionServiceShape['backend'];
  }
): Layer.Layer<DaemonAgentProcessManagerService> =>
  Layer.succeed(DaemonAgentProcessManagerService, {
    executeScopedStopForCommand: (args) =>
      Effect.promise(async () => {
        if (!sessionDeps) return { stoppedCount: 0, failedCount: 0 };
        return executeScopedStopForCommand({
          ...sessionDeps,
          apm: mgr,
          runSerializedForAgent: processManagerService.runSerializedForAgent,
          ...args,
        });
      }),
    runInboxRoleScopedStop: (event) =>
      Effect.promise(async () => {
        const { runRoleScopedStop } =
          await import('../services/service-interfaces.js');
        const legacyReason: Record<string, string> = {
          'team.switch': 'platform.team_switch',
          dedup: 'platform.dedup',
          'stale-config': 'platform.dedup',
        };
        const reason = isAgentStopReason(event.reason)
          ? event.reason
          : (legacyReason[event.reason] ?? 'user.stop');
        if (Date.now() > event.deadline) return;
        const execute = async (
          stopAgent: (opts: StopOpts, signal: AbortSignal) => Promise<{ success: boolean }>,
          signal: AbortSignal
        ) => {
          const result = await runRoleScopedStop({
            apm: mgr,
            confirmedDeps: mgr.getConfirmedStopAdapterDeps(),
            chatroomId: event.chatroomId as string,
            role: event.role,
            reason: reason as AgentStopReason,
          });
          if (result.targets.length === 0 && result.failures.length === 0 && event.pid) {
            await stopAgent(
              {
                chatroomId: event.chatroomId as string,
                role: event.role,
                reason: reason as never,
                pid: event.pid,
              },
              signal
            );
          }
          for (const failure of result.failures)
            console.warn(
              `[daemon] scoped stop failed for ${failure.target.targetKey}`,
              failure.error
            );
        };
        await processManagerService.runSerializedForAgent(
          { chatroomId: event.chatroomId as string, role: event.role },
          { timeoutMs: SCOPE_TARGET_STOP_TIMEOUT_MS },
          async (ops, context) => {
            if (context.signal.aborted) throw context.signal.reason;
            await execute(ops.stopAgent, context.signal);
          }
        );
      }),
    runInboxScopedStop: (event) =>
      Effect.promise(async () => {
        if (!sessionDeps) return;
        const inboxCommandId = (event.commandId ?? event._id) as string;
        const reason = isAgentStopReason(event.reason) ? event.reason : 'user.stop';
        await executeScopedStopForCommand({
          sessionId: sessionDeps.sessionId,
          machineId: sessionDeps.machineId,
          backend: sessionDeps.backend,
          apm: mgr,
          stopCommandId: event.stopCommandId,
          chatroomId: event.chatroomId,
          scope: event.scope,
          reason: reason as AgentStopReason,
          inboxCommandId,
          runSerializedForAgent: processManagerService.runSerializedForAgent,
        });
      }),
    ensureRunning: (opts) => Effect.promise(() => mgr.ensureRunning(opts)),
    stop: (opts) => Effect.promise(() => mgr.stop(opts)),
    handleExit: (opts) => Effect.promise(() => mgr.handleExit(opts)),
    getSlot: (chatroomId, role) => mgr.getSlot(chatroomId, role),
    listActive: () => mgr.listActive(),
    clearStuckStoppingSlot: (chatroomId, role, options) =>
      Effect.promise(() => mgr.clearStuckStoppingSlot(chatroomId, role, options)),
    whenTurnEndsIdle: () => Effect.promise(() => mgr.whenTurnEndsIdle()),
    resumeTurnForSlot: (args) => Effect.promise(() => mgr.resumeTurnForSlot(args)),
    subscribeAgentTurnEnded: (handler) => processManagerService.subscribeAgentTurnEnded(handler),
    subscribeAgentStarted: (handler) => processManagerService.subscribeAgentStarted(handler),
    subscribeAgentSessionLost: (handler) => processManagerService.subscribeAgentSessionLost(handler),
  });

/**
 * Transitional Effect boundary for the queue-backed process manager service.
 * Existing callers continue using DaemonAgentProcessManagerService until they
 * are migrated to this interface.
 */
export class DaemonAgentProcessManagerCommandService extends Context.Tag(
  'DaemonAgentProcessManagerCommandService'
)<DaemonAgentProcessManagerCommandService, AgentProcessManagerService>() {}

export const DaemonAgentProcessManagerCommandServiceLive = (
  service: AgentProcessManagerService
): Layer.Layer<DaemonAgentProcessManagerCommandService> =>
  Layer.succeed(DaemonAgentProcessManagerCommandService, service);

// ─── DaemonSessionService ────────────────────────────────────────────────────

/**
 * Effect service carrying daemon identity fields.
 *
 * Mutable state (lastPushedGitState, lastPushedModels, etc.) is migrating to
 * DaemonMutableStateService (E5). Fields remain on this shape until E5-final.
 */
export interface DaemonSessionServiceShape {
  // ─── Identity ─────────────────────────────────────────────────────
  sessionId: SessionId;
  machineId: string;
  convexUrl: string;
  client: ConvexClient;
  config: MachineConfig | null;
  /** Constructed once by the daemon composition root. */
  taskService?: TaskService | undefined;

  // ─── Flat deps (no ctx.deps.xxx indirection) ──────────────────────
  /** Direct access to backend ops — same as ctx.deps.backend but without the .deps. layer. */
  backend: BackendOps;
  /** Direct access to filesystem ops — same as ctx.deps.fs but without the .deps. layer. */
  fs: FsOps;

  // ─── Shared data ──────────────────────────────────────────────────
  agentServices: Map<string, RemoteAgentService>;
  events: DaemonEventBus;
  /** Populated by workspace-list-subscription; consumed by heartbeats. Mutable reference. */
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number } | undefined;
  logger?: Pick<Console, 'log' | 'warn'> | undefined;
  /** Runtime for Effect execution — provided by `startGitRequestSubscriptionEffect` via `Effect.runtime()`. */
  runtime?: Runtime.Runtime<DaemonSessionService> | undefined;

  // ─── Mutable state (shared reference semantics) ───────────────────
  /** Change-detection cache for git state, keyed by `machineId::workingDir`. */
  lastPushedGitState: Map<string, string>;
  /** Last models snapshot pushed per harness name. null = never pushed. */
  lastPushedModels: Record<string, string[]> | null;
  /** Fingerprint of harness list+versions last successfully pushed. */
  lastPushedHarnessFingerprint: string | null;

  /** Persists structured chatroom events to daemon-local SQLite. */
  logEvent: (event: Record<string, unknown>) => Promise<void>;
}

export class DaemonSessionService extends Context.Tag('DaemonSessionService')<
  DaemonSessionService,
  DaemonSessionServiceShape
>() {}

// ─── DaemonMutableStateService (E5 — Effect.Ref for mutable state) ───────────

/**
 * Effect.Ref-backed mutable state previously held as shared references on
 * DaemonSessionService. Migrating consumers incrementally (E5-2+).
 */
export interface DaemonMutableStateServiceShape {
  lastPushedGitState: Ref.Ref<Map<string, string>>;
  lastPushedModels: Ref.Ref<Record<string, string[]> | null>;
  lastPushedHarnessFingerprint: Ref.Ref<string | null>;
  workspaceListStore: Ref.Ref<{ workspaces: WorkspaceForSync[]; updatedAt: number } | undefined>;
}

export class DaemonMutableStateService extends Context.Tag('DaemonMutableStateService')<
  DaemonMutableStateService,
  DaemonMutableStateServiceShape
>() {}

/** Build DaemonMutableStateService layer from initial values. */
export function DaemonMutableStateServiceLive(init: {
  lastPushedGitState: Map<string, string>;
  lastPushedModels: Record<string, string[]> | null;
  lastPushedHarnessFingerprint: string | null;
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number } | undefined;
}) {
  return Layer.effect(
    DaemonMutableStateService,
    Effect.gen(function* () {
      return {
        lastPushedGitState: yield* Ref.make(init.lastPushedGitState),
        lastPushedModels: yield* Ref.make(init.lastPushedModels),
        lastPushedHarnessFingerprint: yield* Ref.make(init.lastPushedHarnessFingerprint),
        workspaceListStore: yield* Ref.make(init.workspaceListStore),
      };
    })
  );
}
