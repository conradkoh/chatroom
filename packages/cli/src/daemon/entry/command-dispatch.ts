/**
 * Command event dispatch — handles daemon command events from v2 inbound nudges.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { AGENT_REQUEST_DEADLINE_MS } from '@workspace/backend/config/reliability.js';
import type { MachineCommandPayload } from '@workspace/backend/src/domain/entities/machine-command.js';
import { Effect, Layer, type Context } from 'effect';

import { api } from '../../api.js';
import { createRefreshMachineCapabilitiesDeps } from './bridge/capabilities-bridge.js';
import { createGitCloneJobDeps } from './bridge/git-clone-bridge.js';
import { isDaemonCommandEventType, type DaemonCommandEventType } from './command-event-types.js';
import { DaemonSessionService } from './daemon-services.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonAgentProcessManagerCommandService,
  DaemonMutableStateService,
  DaemonSessionServiceShape,
} from './daemon-services.js';
import { formatTimestamp } from './daemon-utils.js';
import { getMachineBackupService } from './machine-backup-runtime.js';
import { getRepositoryLedgerService } from './repository-ledger-runtime.js';
import type { ClaimedMachineCommand } from '../infrastructure/convex/subscribers/machine-command-inbox.js';
import { logDaemonAuditEvent } from '../infrastructure/event-stream/daemon-event-emitter.js';
import type { AgentWorkManager } from '../services/service-interfaces.js';
import { onRequestRestartAgentEffect } from './events/agent/on-request-restart-agent.js';
import { onRequestStartAgentEffect } from './events/agent/on-request-start-agent.js';
import { handlePing } from './handlers/ping.js';
import { processManager } from './handlers/process/manager.js';
import { capabilitiesOutcomeToStatus } from './refresh-models-outcome.js';
import { executeLocalAction } from '../../infrastructure/local-actions/index.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import { refreshMachineCapabilities } from '../domain/usecase/refresh-machine-capabilities.js';
import { createGitCloneJobRunner } from '../domain/usecase/run-git-clone-job.js';
import type { WorkspaceRefreshReason } from '../services/workspace-service/index.js';

/** Event shape delivered from the machine command inbox (formerly machines.getCommandEvents). */
type CommandEvent = {
  _id: string;
  _creationTime: number;
  machineId: string;
  deadline: number;
  timestamp: number;
} & MachineCommandPayload;

/** Consolidates dedup maps into a single container. */
export interface DedupTracker {
  commandIds: Map<string, number>;
  pingIds: Map<string, number>;
  gitRefreshIds: Map<string, number>;
  capabilitiesRefreshIds: Map<string, number>;
  localActionIds: Map<string, number>;
  gitCloneIds: Map<string, number>;
  syncProjectRootsIds: Map<string, number>;
  reportRepositoryLedgerIds: Map<string, number>;
  reportMachineBackupsIds: Map<string, number>;
  uploadMachineBackupIds: Map<string, number>;
}

/** Union of services required to dispatch any command event. */
export type CommandDispatchDeps =
  | DaemonAgentProcessManagerService
  | DaemonAgentProcessManagerCommandService
  | DaemonMutableStateService
  | DaemonSessionService;

function evictStaleEntries(entries: Map<string, number>, evictBefore: number): void {
  for (const [id, ts] of entries) {
    if (ts < evictBefore) entries.delete(id);
  }
}

export function evictStaleDedupEntries(tracker: DedupTracker): void {
  const evictBefore = Date.now() - AGENT_REQUEST_DEADLINE_MS;
  evictStaleEntries(tracker.commandIds, evictBefore);
  evictStaleEntries(tracker.pingIds, evictBefore);
  evictStaleEntries(tracker.gitRefreshIds, evictBefore);
  evictStaleEntries(tracker.capabilitiesRefreshIds, evictBefore);
  evictStaleEntries(tracker.localActionIds, evictBefore);
  evictStaleEntries(tracker.gitCloneIds, evictBefore);
  evictStaleEntries(tracker.syncProjectRootsIds, evictBefore);
  evictStaleEntries(tracker.reportRepositoryLedgerIds, evictBefore);
  evictStaleEntries(tracker.reportMachineBackupsIds, evictBefore);
  evictStaleEntries(tracker.uploadMachineBackupIds, evictBefore);
  processManager.evictStalePendingStops();
}

export function createDedupTracker(): DedupTracker {
  return {
    commandIds: new Map<string, number>(),
    pingIds: new Map<string, number>(),
    gitRefreshIds: new Map<string, number>(),
    capabilitiesRefreshIds: new Map<string, number>(),
    localActionIds: new Map<string, number>(),
    gitCloneIds: new Map<string, number>(),
    syncProjectRootsIds: new Map<string, number>(),
    reportRepositoryLedgerIds: new Map<string, number>(),
    reportMachineBackupsIds: new Map<string, number>(),
    uploadMachineBackupIds: new Map<string, number>(),
  };
}

function handleRequestStartEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.commandIds.has(eventId)) return;
    yield* onRequestStartAgentEffect(
      event as unknown as Parameters<typeof onRequestStartAgentEffect>[0]
    );
    tracker.commandIds.set(eventId, Date.now());
  });
}

function handleRequestRestartEffect(
  event: CommandEvent,
  tracker: DedupTracker,
  nativeDelivery: Pick<
    AgentWorkManager,
    'prepareRoleRecovery' | 'recoverStoppedRole' | 'reconcileAfterAgentRestart'
  >
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.commandIds.has(eventId)) return;
    yield* onRequestRestartAgentEffect(
      event as unknown as Parameters<typeof onRequestRestartAgentEffect>[0],
      nativeDelivery
    );
    tracker.commandIds.set(eventId, Date.now());
  });
}

function handlePingCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.pingIds.has(eventId)) return;
    handlePing();
    const session = yield* DaemonSessionService;
    yield* Effect.promise(() =>
      logDaemonAuditEvent(session.logEvent, {
        type: 'daemon.pong',
        machineId: session.machineId,
        pingEventId: event._id,
      })
    );
    tracker.pingIds.set(eventId, Date.now());
  });
}

/** Refreshes a workspace's monitor. A failure is logged and never fails the command. */
function refreshWorkspaceEffect(
  session: DaemonSessionServiceShape,
  workingDir: string,
  reason: WorkspaceRefreshReason
): Effect.Effect<void> {
  return Effect.promise(() =>
    session.workspaceService.refresh(workingDir, reason).catch((error: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Workspace refresh failed for ${workingDir}: ${getErrorMessage(error)}`
      );
    })
  );
}

function handleGitRefreshCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.gitRefreshIds.has(eventId)) return;
    const session = yield* DaemonSessionService;
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.gitRefresh' }>;
    console.log(`[${formatTimestamp()}] 🔄 Git refresh requested for ${typedEvent.workingDir}`);
    yield* refreshWorkspaceEffect(session, typedEvent.workingDir, 'command');
    tracker.gitRefreshIds.set(eventId, Date.now());
  });
}

const GIT_PUSH_ACTIONS = new Set(['git-pull', 'git-push', 'git-sync', 'git-discard-all']);

function handleLocalActionCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.localActionIds.has(eventId)) return;
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.localAction' }>;
    console.log(
      `[${formatTimestamp()}] 🖥️  Local action: ${typedEvent.action} → ${typedEvent.workingDir}`
    );
    const result = yield* Effect.promise(() =>
      executeLocalAction(typedEvent.action, typedEvent.workingDir, {
        chatroomId: typedEvent.chatroomId,
      })
    );
    if (!result.success) {
      console.warn(`[${formatTimestamp()}] ⚠️  Local action failed: ${result.error}`);
    } else if (GIT_PUSH_ACTIONS.has(typedEvent.action)) {
      const session = yield* DaemonSessionService;
      yield* refreshWorkspaceEffect(session, typedEvent.workingDir, 'local-action');
    }
    tracker.localActionIds.set(eventId, Date.now());
  });
}

/**
 * `daemon.pickFolder` is retired: the native dialog was replaced by the inline remote folder
 * browser (`folderBrowse.daemonPending`). A historical inbox row may still arrive, so acknowledge it
 * without opening a dialog or touching the backend.
 */
function handleRetiredPickFolderCommandEffect(
  event: CommandEvent
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.sync(() => {
    console.warn(
      `[${formatTimestamp()}] 📂 daemon.pickFolder is retired; ignoring ${event._id.toString()}`
    );
  });
}

/** Owns the clone in-flight registry for this daemon. Dedup by event id stays on the tracker. */
const gitCloneRunner = createGitCloneJobRunner();

function logGitCloneWarning(error: unknown): void {
  console.warn(`[${formatTimestamp()}] ⚠️  Git clone failed: ${getErrorMessage(error)}`);
}

function handleGitCloneCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.gitCloneIds.has(eventId)) return;
    tracker.gitCloneIds.set(eventId, Date.now());
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.gitClone' }>;
    const { requestId, targetPath, repoUrl } = typedEvent;
    const session = yield* DaemonSessionService;
    const deps = createGitCloneJobDeps(session, requestId);

    // The job must NOT be awaited: the inbox serializes MACHINE_COMMAND_KEY work and acks only
    // after this handler returns, so awaiting a long clone would stall every command.
    const outcome = gitCloneRunner.start(deps, { requestId, repoUrl, targetPath });
    if (outcome === 'duplicate') return; // Same request redelivered while its clone still runs.
    if (outcome === 'busy') {
      void deps
        .reportResult({
          status: 'failed',
          errorCode: 'target_not_empty',
          errorMessage: 'A clone into this folder is already in progress',
        })
        .catch(logGitCloneWarning);
      return;
    }
    console.log(`[${formatTimestamp()}] 📥 Git clone requested → ${targetPath}`);
  });
}

function logLedgerRefreshWarning(error: unknown): void {
  console.warn(
    `[${formatTimestamp()}] ⚠️  Repository ledger refresh failed: ${getErrorMessage(error)}`
  );
}

function handleSyncProjectRootsEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.syncProjectRootsIds.has(eventId)) return;
    tracker.syncProjectRootsIds.set(eventId, Date.now());
    const session = yield* DaemonSessionService;
    // Not awaited: the inbox serializes command work, and a scan must never stall the chain.
    try {
      void getRepositoryLedgerService(session)
        .refresh('roots-changed')
        .catch(logLedgerRefreshWarning);
    } catch (error) {
      logLedgerRefreshWarning(error);
    }
  });
}

function handleReportRepositoryLedgerEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.reportRepositoryLedgerIds.has(eventId)) return;
    tracker.reportRepositoryLedgerIds.set(eventId, Date.now());
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.reportRepositoryLedger' }>;
    const session = yield* DaemonSessionService;
    // Not awaited: the job runs in the background. serveSnapshot starts it synchronously and never throws.
    // 'duplicate' means a job for this requestId is already running, so there is nothing to do.
    getRepositoryLedgerService(session).serveSnapshot({
      requestId: typedEvent.requestId,
      rescan: typedEvent.rescan,
    });
  });
}

function logMachineBackupWarning(error: unknown): void {
  console.warn(
    `[${formatTimestamp()}] ⚠️  Machine backup command failed to start: ${getErrorMessage(error)}`
  );
}

function handleReportMachineBackupsEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.reportMachineBackupsIds.has(eventId)) return;
    tracker.reportMachineBackupsIds.set(eventId, Date.now());
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.reportMachineBackups' }>;
    const session = yield* DaemonSessionService;
    try {
      // Not awaited: the inbox serializes command work. 'duplicate' means the job already runs.
      getMachineBackupService(session).serveInventory({ requestId: typedEvent.requestId });
    } catch (error) {
      logMachineBackupWarning(error);
    }
  });
}

function handleUploadMachineBackupEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.uploadMachineBackupIds.has(eventId)) return;
    tracker.uploadMachineBackupIds.set(eventId, Date.now());
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.uploadMachineBackup' }>;
    const session = yield* DaemonSessionService;
    try {
      // Same contract as the inventory handler: start and return; the job reports its own outcome.
      getMachineBackupService(session).serveUpload({
        requestId: typedEvent.requestId,
        filename: typedEvent.filename,
      });
    } catch (error) {
      logMachineBackupWarning(error);
    }
  });
}

function handleRefreshCapabilitiesEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService | DaemonMutableStateService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.capabilitiesRefreshIds.has(eventId)) return;
    console.log(`[${formatTimestamp()}] 🔄 Manual capabilities refresh requested`);
    const effectContext = yield* Effect.context<DaemonSessionService | DaemonMutableStateService>();
    const outcome = yield* Effect.promise(() =>
      refreshMachineCapabilities(
        createRefreshMachineCapabilitiesDeps(Layer.succeedContext(effectContext))
      )
    );
    tracker.capabilitiesRefreshIds.set(eventId, Date.now());
    const batchId = 'batchId' in event ? (event as any).batchId : undefined;
    if (!batchId) return;
    const session = yield* DaemonSessionService;
    const { status, errorMessage } = capabilitiesOutcomeToStatus(outcome);
    yield* Effect.tryPromise({
      try: () =>
        session.backend.mutation(api.machines.reportCapabilitiesRefreshResult, {
          sessionId: session.sessionId,
          batchId,
          machineId: session.machineId,
          status,
          errorMessage,
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn(
            `[${formatTimestamp()}] ⚠️  Capabilities refresh report failed: ${getErrorMessage(error)}`
          );
        })
      )
    );
  });
}

const commandEventHandlers: {
  [K in DaemonCommandEventType]?: (
    event: CommandEvent,
    tracker: DedupTracker,
    nativeDelivery: Pick<
      AgentWorkManager,
      'prepareRoleRecovery' | 'recoverStoppedRole' | 'reconcileAfterAgentRestart'
    >
  ) => Effect.Effect<void, never, CommandDispatchDeps>;
} = {
  'agent.requestStart': handleRequestStartEffect,
  'agent.restart': handleRequestRestartEffect,
  'daemon.ping': handlePingCommandEffect,
  'daemon.gitRefresh': handleGitRefreshCommandEffect,
  'daemon.localAction': handleLocalActionCommandEffect,
  'daemon.pickFolder': handleRetiredPickFolderCommandEffect,
  'daemon.gitClone': handleGitCloneCommandEffect,
  'daemon.syncProjectRoots': handleSyncProjectRootsEffect,
  'daemon.reportRepositoryLedger': handleReportRepositoryLedgerEffect,
  'daemon.reportMachineBackups': handleReportMachineBackupsEffect,
  'daemon.uploadMachineBackup': handleUploadMachineBackupEffect,
  'daemon.refreshCapabilities': handleRefreshCapabilitiesEffect,
};

export const dispatchCommandEventEffect = (
  event: CommandEvent,
  tracker: DedupTracker,
  nativeDelivery: Pick<
    AgentWorkManager,
    'prepareRoleRecovery' | 'recoverStoppedRole' | 'reconcileAfterAgentRestart'
  >
): Effect.Effect<void, never, CommandDispatchDeps> => {
  if (!isDaemonCommandEventType(event.type)) return Effect.void;
  const factory = commandEventHandlers[event.type];
  return factory != null ? factory(event, tracker, nativeDelivery) : Effect.void;
};

export async function handleInboundCommandEvent(
  commandId: string,
  tracker: DedupTracker,
  effectContext: Context.Context<CommandDispatchDeps>,
  claimedCommand: ClaimedMachineCommand,
  nativeDelivery: Pick<
    AgentWorkManager,
    'prepareRoleRecovery' | 'recoverStoppedRole' | 'reconcileAfterAgentRestart'
  >
): Promise<void> {
  if (claimedCommand.commandId !== commandId) return;
  const { commandId: _id, machineId, deadline, timestamp, ...rest } = claimedCommand;
  await Effect.runPromise(
    dispatchCommandEventEffect(
      { _id, machineId, deadline, timestamp, ...rest } as unknown as CommandEvent,
      tracker,
      nativeDelivery
    ).pipe(Effect.provide(effectContext))
  );
}
// fallow-ignore-file code-duplication
