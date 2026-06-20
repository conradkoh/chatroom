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

import type { MachineStateOps, SpawningOps } from './deps.js';
import type { ConvexClient, SessionId, WorkspaceForSync } from './types.js';
import type { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import type { BackendOps, FsOps } from '../../../infrastructure/deps/index.js';
import type { AgentHarness, MachineConfig } from '../../../infrastructure/machine/types.js';
import type {
  AgentProcessManager,
  AgentSlot,
  EnsureRunningOpts,
  HandleExitOpts,
  OperationResult,
  StopOpts,
} from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';
import type { SpawnOptions } from '../../../infrastructure/services/harness-spawning/harness-spawning-service.js';
import type { TryConsumeResult } from '../../../infrastructure/services/harness-spawning/index.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';

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

/** Effect service wrapping SpawningOps (rate-limiting, concurrent agent tracking). */
export interface DaemonSpawningServiceShape {
  /** Synchronous — returns the decision immediately without suspending. */
  shouldAllowSpawn: (
    chatroomId: string,
    reason: string,
    options?: SpawnOptions
  ) => TryConsumeResult;
  recordSpawn: (chatroomId: string) => void;
  recordExit: (chatroomId: string) => void;
  getConcurrentCount: (chatroomId: string) => number;
}

// fallow-ignore-next-line unused-export
export class DaemonSpawningService extends Context.Tag('DaemonSpawningService')<
  DaemonSpawningService,
  DaemonSpawningServiceShape
>() {}

export const DaemonSpawningServiceLive = (ops: SpawningOps): Layer.Layer<DaemonSpawningService> =>
  Layer.succeed(DaemonSpawningService, {
    shouldAllowSpawn: (chatroomId, reason, options) =>
      ops.shouldAllowSpawn(chatroomId, reason, options),
    recordSpawn: (chatroomId) => ops.recordSpawn(chatroomId),
    recordExit: (chatroomId) => ops.recordExit(chatroomId),
    getConcurrentCount: (chatroomId) => ops.getConcurrentCount(chatroomId),
  });

// ─── DaemonAgentProcessManagerService ───────────────────────────────────────

/** Effect service wrapping AgentProcessManager — precise types from the class. */
export interface DaemonAgentProcessManagerServiceShape {
  ensureRunning: (opts: EnsureRunningOpts) => Effect.Effect<OperationResult>;
  stop: (opts: StopOpts) => Effect.Effect<{ success: boolean }>;
  handleExit: (opts: HandleExitOpts) => Effect.Effect<void>;
  recover: () => Effect.Effect<void>;
  /** Synchronous slot lookup — returns undefined when the slot has no entry. */
  getSlot: (chatroomId: string, role: string) => AgentSlot | undefined;
  listActive: () => { chatroomId: string; role: string; slot: AgentSlot }[];
  /** Waits until any in-progress agent turn ends and the manager becomes idle. */
  whenTurnEndsIdle: () => Effect.Effect<void>;
}

export class DaemonAgentProcessManagerService extends Context.Tag(
  'DaemonAgentProcessManagerService'
)<DaemonAgentProcessManagerService, DaemonAgentProcessManagerServiceShape>() {}

export const DaemonAgentProcessManagerServiceLive = (
  mgr: AgentProcessManager
): Layer.Layer<DaemonAgentProcessManagerService> =>
  Layer.succeed(DaemonAgentProcessManagerService, {
    ensureRunning: (opts) => Effect.promise(() => mgr.ensureRunning(opts)),
    stop: (opts) => Effect.promise(() => mgr.stop(opts)),
    handleExit: (opts) => Effect.promise(() => mgr.handleExit(opts)),
    recover: () => Effect.promise(() => mgr.recover()),
    getSlot: (chatroomId, role) => mgr.getSlot(chatroomId, role),
    listActive: () => mgr.listActive(),
    whenTurnEndsIdle: () => Effect.promise(() => mgr.whenTurnEndsIdle()),
  });

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

  // ─── Flat deps (no ctx.deps.xxx indirection) ──────────────────────
  /** Direct access to backend ops — same as ctx.deps.backend but without the .deps. layer. */
  backend: BackendOps;
  /** Direct access to filesystem ops — same as ctx.deps.fs but without the .deps. layer. */
  fs: FsOps;

  // ─── Shared data ──────────────────────────────────────────────────
  agentServices: Map<string, RemoteAgentService>;
  events: DaemonEventBus;
  /** Populated by workspace-list-subscription; consumed by heartbeats. Mutable reference. */
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number };
  logger?: Pick<Console, 'log' | 'warn'>;
  /** Runtime for Effect execution — provided by `startGitRequestSubscriptionEffect` via `Effect.runtime()`. */
  runtime?: Runtime.Runtime<DaemonSessionService>;

  // ─── Mutable state (shared reference semantics) ───────────────────
  /** Change-detection cache for git state, keyed by `machineId::workingDir`. */
  lastPushedGitState: Map<string, string>;
  /** Last models snapshot pushed per harness name. null = never pushed. */
  lastPushedModels: Record<string, string[]> | null;
  /** Fingerprint of harness list+versions last successfully pushed. */
  lastPushedHarnessFingerprint: string | null;
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
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number };
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
