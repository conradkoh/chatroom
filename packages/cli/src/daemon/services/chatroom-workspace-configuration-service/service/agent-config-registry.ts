import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../../../api.js';
import type { AgentConfigInboxEvent } from '../infrastructure/adapters/convex-agent-config-gateway.js';
import {
  createConvexAgentConfigGateway,
  mapAgentConfigInboxRows,
} from '../infrastructure/adapters/convex-agent-config-gateway.js';

/** Runtime config for one `(chatroomId, role)` agent, resolved by the daemon. */
export interface AgentConfigEntry {
  readonly agentHarness: string;
  readonly model: string;
  readonly workingDir: string;
}

export interface AgentConfigRegistryDependencies {
  readonly sessionId: string;
  readonly machineId: string;
  readonly backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}

/** Delay between acknowledgement retries until the backend confirms. */
const ACK_RETRY_DELAY_MS = 1_000;

/** Prevent a pending acknowledgement timer from keeping the daemon alive. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  timer.unref?.();
}

export interface AgentConfigRegistry {
  /**
   * Replays pending inbox events, then follows the live inbox watch. With a
   * `wsClient` the watch's initial fire is the boot replay; without one, the
   * pending list is fetched once (test / offline mode).
   */
  start(wsClient?: ConvexClient): Promise<void>;
  /** Detaches the watch and cancels ack retries; applied entries stay readable. */
  stop(): void;
  /** Latest agent config for one `(chatroomId, role)`; undefined when unknown. */
  get(chatroomId: string, role: string): AgentConfigEntry | undefined;
  /** Whether config is ready, still synchronizing, or absent for this machine. */
  state?(chatroomId: string, role: string): 'ready' | 'syncing' | 'absent';
}

/**
 * Daemon-local read model of "who runs where and how", fed exclusively by the
 * `chatroomWorkspaceAgentConfigInbox` durable inbox (served via
 * `api.daemon.agentConfigInbox`).
 *
 * Delivery reads this service at decision time; the agent process service
 * never does — it receives config in its start inputs at spawn time.
 *
 * Failure boundaries are deliberately split: an event is applied to the local
 * map *before* it is acknowledged, and acknowledgements retry until the
 * backend confirms. A lost ack therefore re-delivers the event on the next
 * boot without re-applying work — applying is idempotent upsert per
 * `(chatroomId, role)`.
 */
export function createAgentConfigRegistry(
  deps: AgentConfigRegistryDependencies
): AgentConfigRegistry {
  const gateway = createConvexAgentConfigGateway(deps.backend);

  /** Applied agent configs, keyed `chatroomId:role` (role lowercased). */
  const configs = new Map<string, AgentConfigEntry>();
  /** Events seen but not yet durably acked; guards ack retries. */
  const pendingEventIds = new Set<string>();
  const pendingConfigKeys = new Set<string>();
  const pendingEventKeys = new Map<string, string>();
  const ackRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;
  let initialReplayComplete = false;
  let stopWatch: (() => void) | undefined;

  /** Roles are case-insensitive across the daemon; keys normalize to lowercase. */
  const entryKey = (chatroomId: string, role: string): string =>
    `${chatroomId}:${role.toLowerCase()}`;

  /**
   * Validates and applies one event. Returns false for events that must not
   * shape local state (foreign machine, non-remote agent); those are logged
   * and still acked so they never replay.
   */
  const applyEvent = (event: AgentConfigInboxEvent): boolean => {
    const key = entryKey(event.chatroomId, event.role);
    if (event.machineId !== deps.machineId) {
      console.warn(
        `[AgentConfigRegistry] ignoring config event for foreign machine ${event.machineId}`
      );
      return false;
    }
    if (event.agentType !== 'remote') {
      console.warn(
        `[AgentConfigRegistry] ignoring non-remote config event (agentType=${event.agentType})`
      );
      return false;
    }
    configs.set(key, {
      agentHarness: event.agentHarness,
      model: event.model,
      workingDir: event.workingDir,
    });
    return true;
  };

  /** Ack one event, retrying with backoff until the backend confirms. */
  const acknowledge = async (eventId: string): Promise<void> => {
    try {
      await gateway.markAgentConfigEventProcessed({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        eventId,
      });
      pendingEventIds.delete(eventId);
      const key = pendingEventKeys.get(eventId);
      if (key) {
        pendingEventKeys.delete(eventId);
        pendingConfigKeys.delete(key);
      }
      const timer = ackRetryTimers.get(eventId);
      if (timer) clearTimeout(timer);
      ackRetryTimers.delete(eventId);
    } catch (error) {
      console.warn('[AgentConfigRegistry] config event acknowledgement failed:', error);
      scheduleAckRetry(eventId);
    }
  };

  const scheduleAckRetry = (eventId: string): void => {
    if (stopped) return;
    if (ackRetryTimers.has(eventId)) return;
    if (!pendingEventIds.has(eventId)) return;

    const timer = setTimeout(() => {
      ackRetryTimers.delete(eventId);
      void acknowledge(eventId);
    }, ACK_RETRY_DELAY_MS);
    unrefTimer(timer);
    ackRetryTimers.set(eventId, timer);
  };

  /**
   * Applies a batch in `createdAt` order (the backend query is ascending), so
   * a superseding config event always wins over the one it replaces.
   */
  const reconcile = async (events: readonly AgentConfigInboxEvent[]): Promise<void> => {
    for (const event of events) {
      if (stopped) return;
      pendingEventIds.add(event.eventId);
      const key = entryKey(event.chatroomId, event.role);
      pendingEventKeys.set(event.eventId, key);
      pendingConfigKeys.add(key);
      applyEvent(event);
      await acknowledge(event.eventId);
    }
  };

  /**
   * Validates raw backend rows, then reconciles. A batch that fails
   * validation is logged loudly and left unprocessed — its events stay
   * pending in the backend inbox and are re-delivered on the next boot,
   * rather than being acked or partially applied.
   */
  const reconcileRows = async (rows: unknown): Promise<void> => {
    let events: readonly AgentConfigInboxEvent[];
    try {
      events = mapAgentConfigInboxRows(rows);
    } catch (error) {
      console.error(
        '[AgentConfigRegistry] agent config inbox rows deviate from the declared structure — skipping batch:',
        error
      );
      return;
    }
    await reconcile(events);
  };

  const startWatch = (wsClient: ConvexClient): void => {
    if (stopWatch) return;

    // The watch fires immediately with the current pending rows, which doubles
    // as the boot-time replay; no separate fetch is needed.
    stopWatch = wsClient.onUpdate(
      api.daemon.agentConfigInbox.listPending,
      { sessionId: deps.sessionId as SessionId, machineId: deps.machineId },
      (rows) => {
        void reconcileRows(rows).finally(() => {
          initialReplayComplete = true;
        });
      },
      (error) => console.warn(`[daemon] agent-config watch error: ${String(error)}`)
    );
  };

  const replayPending = async (): Promise<void> => {
    try {
      await reconcile(
        await gateway.listPendingAgentConfigEvents({
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        })
      );
      initialReplayComplete = true;
    } catch (error) {
      console.error(
        '[AgentConfigRegistry] agent config inbox rows deviate from the declared structure — skipping batch:',
        error
      );
    }
  };

  return {
    start: async (wsClient) => {
      stopped = false;
      if (wsClient) {
        startWatch(wsClient);
        return;
      }
      await replayPending();
    },
    stop: () => {
      stopped = true;
      stopWatch?.();
      stopWatch = undefined;
      pendingEventIds.clear();
      pendingEventKeys.clear();
      pendingConfigKeys.clear();
      initialReplayComplete = false;
      for (const timer of ackRetryTimers.values()) clearTimeout(timer);
      ackRetryTimers.clear();
    },
    get: (chatroomId, role) => configs.get(entryKey(chatroomId, role)),
    state: (chatroomId, role) => {
      const key = entryKey(chatroomId, role);
      if (pendingConfigKeys.has(key) || !initialReplayComplete) return 'syncing';
      if (configs.has(key)) return 'ready';
      return 'absent';
    },
  };
}
