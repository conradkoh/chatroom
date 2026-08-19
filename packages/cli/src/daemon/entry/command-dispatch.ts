/**
 * Command event dispatch — handles daemon command events from v2 inbound nudges.
 */

import { AGENT_REQUEST_DEADLINE_MS } from '@workspace/backend/config/reliability.js';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Layer, Ref, type Context } from 'effect';

import { pushSingleWorkspaceGitStateEffect } from './workspace-git/git-heartbeat.js';
import { api } from '../../api.js';
import { createRefreshMachineCapabilitiesDeps } from './bridge/capabilities-bridge.js';
import { isDaemonCommandEventType, type DaemonCommandEventType } from './command-event-types.js';
import { pushSingleWorkspaceCommandsEffect } from './command-sync-heartbeat.js';
import {
  DaemonMutableStateService,
  DaemonSessionService,
  type DaemonAgentProcessManagerService,
  type DaemonSessionServiceShape,
} from './daemon-services.js';
import { formatTimestamp } from './daemon-utils.js';
import { logDaemonAuditEvent } from '../infrastructure/event-stream/daemon-event-emitter.js';
import { onRequestRestartAgentEffect } from './events/agent/on-request-restart-agent.js';
import { onRequestStartAgentEffect } from './events/agent/on-request-start-agent.js';
import { onRequestStopAgentEffect } from './events/agent/on-request-stop-agent.js';
import { handlePing } from './handlers/ping.js';
import { processManager } from './handlers/process/manager.js';
import { capabilitiesOutcomeToStatus } from './refresh-models-outcome.js';
import { executeLocalAction } from '../../infrastructure/local-actions/index.js';
import { pickFolderDialog } from '../../infrastructure/local-actions/pick-folder.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import { refreshMachineCapabilities } from '../domain/usecase/refresh-machine-capabilities.js';
import { makeGitStateKey } from '../infrastructure/git/types.js';

/** The inferred return type of the getCommandEvents Convex query. */
type CommandEventsResult = FunctionReturnType<typeof api.machines.getCommandEvents>;

/** A single event from the command event stream. */
type CommandEvent = CommandEventsResult['events'][number];

/** Consolidates dedup maps into a single container. */
export interface DedupTracker {
  commandIds: Map<string, number>;
  pingIds: Map<string, number>;
  gitRefreshIds: Map<string, number>;
  capabilitiesRefreshIds: Map<string, number>;
  localActionIds: Map<string, number>;
  pickFolderIds: Map<string, number>;
}

/** Union of services required to dispatch any command event. */
export type CommandDispatchDeps =
  DaemonAgentProcessManagerService | DaemonMutableStateService | DaemonSessionService;

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
  evictStaleEntries(tracker.pickFolderIds, evictBefore);
  processManager.evictStalePendingStops();
}

export function createDedupTracker(): DedupTracker {
  return {
    commandIds: new Map<string, number>(),
    pingIds: new Map<string, number>(),
    gitRefreshIds: new Map<string, number>(),
    capabilitiesRefreshIds: new Map<string, number>(),
    localActionIds: new Map<string, number>(),
    pickFolderIds: new Map<string, number>(),
  };
}

function handleRequestStartEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.commandIds.has(eventId)) return;
    yield* onRequestStartAgentEffect(event as Parameters<typeof onRequestStartAgentEffect>[0]);
    tracker.commandIds.set(eventId, Date.now());
  });
}

function handleRequestRestartEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.commandIds.has(eventId)) return;
    yield* onRequestRestartAgentEffect(event as Parameters<typeof onRequestRestartAgentEffect>[0]);
    tracker.commandIds.set(eventId, Date.now());
  });
}

function handleRequestStopEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonAgentProcessManagerService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.commandIds.has(eventId)) return;
    yield* onRequestStopAgentEffect(event as Parameters<typeof onRequestStopAgentEffect>[0]);
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

function handleGitRefreshCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.gitRefreshIds.has(eventId)) return;
    const session = yield* DaemonSessionService;
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.gitRefresh' }>;
    const mutable = yield* DaemonMutableStateService;
    const lastPushedGitState = yield* Ref.get(mutable.lastPushedGitState);
    lastPushedGitState.delete(makeGitStateKey(session.machineId, typedEvent.workingDir));
    console.log(`[${formatTimestamp()}] 🔄 Git refresh requested for ${typedEvent.workingDir}`);
    yield* pushSingleWorkspaceGitStateEffect(typedEvent.workingDir);
    yield* pushSingleWorkspaceCommandsEffect(typedEvent.workingDir);
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
      const mutable = yield* DaemonMutableStateService;
      const lastPushedGitState = yield* Ref.get(mutable.lastPushedGitState);
      lastPushedGitState.delete(makeGitStateKey(session.machineId, typedEvent.workingDir));
      yield* pushSingleWorkspaceGitStateEffect(typedEvent.workingDir);
    }
    tracker.localActionIds.set(eventId, Date.now());
  });
}

function handlePickFolderCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.pickFolderIds.has(eventId)) return;
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.pickFolder' }>;
    console.log(`[${formatTimestamp()}] 📂 Folder picker requested`);
    const result = yield* Effect.sync(() => pickFolderDialog());
    const session = yield* DaemonSessionService;
    const status = result.success ? 'completed' : result.cancelled ? 'cancelled' : 'failed';
    yield* Effect.tryPromise({
      try: () =>
        session.backend.mutation(api.machines.reportFolderPickerResult, {
          sessionId: session.sessionId,
          requestId: typedEvent.requestId,
          machineId: session.machineId,
          status,
          selectedPath: result.success ? result.path : undefined,
          errorMessage: result.success ? undefined : result.error,
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.warn(
            `[${formatTimestamp()}] ⚠️  Folder picker report failed: ${getErrorMessage(error)}`
          );
        })
      )
    );
    if (!result.success && !result.cancelled) {
      console.warn(`[${formatTimestamp()}] ⚠️  Folder picker failed: ${result.error}`);
    }
    tracker.pickFolderIds.set(eventId, Date.now());
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      Effect.catchAll((error) =>
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
    tracker: DedupTracker
  ) => Effect.Effect<void, never, CommandDispatchDeps>;
} = {
  'agent.requestStart': handleRequestStartEffect,
  'agent.restart': handleRequestRestartEffect,
  'agent.requestStop': handleRequestStopEffect,
  'daemon.ping': handlePingCommandEffect,
  'daemon.gitRefresh': handleGitRefreshCommandEffect,
  'daemon.localAction': handleLocalActionCommandEffect,
  'daemon.pickFolder': handlePickFolderCommandEffect,
  'daemon.refreshCapabilities': handleRefreshCapabilitiesEffect,
};

export const dispatchCommandEventEffect = (
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> => {
  if (!isDaemonCommandEventType(event.type)) return Effect.void;
  const factory = commandEventHandlers[event.type];
  return factory != null ? factory(event, tracker) : Effect.void;
};

export async function handleInboundCommandEvent(
  commandId: string,
  tracker: DedupTracker,
  effectContext: Context.Context<CommandDispatchDeps>,
  session: DaemonSessionServiceShape
): Promise<void> {
  const result = await session.backend.query(api.machines.getCommandEvents, {
    sessionId: session.sessionId,
    machineId: session.machineId,
  });
  const event = result?.events?.find((e: CommandEvent) => e._id.toString() === commandId);
  if (!event) return;
  await Effect.runPromise(
    dispatchCommandEventEffect(event, tracker).pipe(Effect.provide(effectContext))
  );
}
