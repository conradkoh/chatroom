import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { MachineAgentOperationalRow } from './agent-operational-read-model.js';
import type { Id } from '../../../api.js';
import { api } from '../../../api.js';
import type { NativeTaskDeliverySessionDeps } from '../../services/service-interfaces.js';

export type OperationalSignalKind = 'agent-operational' | 'agent-stop';

export type OperationalStatusSignal = {
  readonly chatroomId: string;
  readonly role: string;
  readonly revisionKey: string;
  readonly signalKey: string;
  readonly projectedAt: number;
};

export type OperationalSignalPage = {
  readonly items: readonly OperationalStatusSignal[];
  readonly afterSignalKey: string;
  readonly highSignalKey: string;
};

export type OperationalSignalHydration = {
  readonly rows: readonly MachineAgentOperationalRow[];
  readonly nextSignalKey: string | null;
  readonly hasMore: boolean;
};

export type OperationalSignalFeed = {
  readonly kind: OperationalSignalKind;
  readonly subscribe: (
    client: ConvexClient,
    input: {
      sessionId: SessionId;
      machineId: string;
      chatroomId: string;
      afterKey: string;
      limit: number;
    },
    onResult: (result: unknown) => void,
    onError: (error: unknown) => void
  ) => () => void;
  readonly hydrate: (
    client: ConvexClient,
    input: {
      sessionId: SessionId;
      machineId: string;
      chatroomId: string;
      afterSignalKey: string;
      throughSignalKey: string;
      limit: number;
    }
  ) => Promise<OperationalSignalHydration>;
  readonly acknowledge: (
    sessionDeps: NativeTaskDeliverySessionDeps,
    input: { machineId: string; chatroomId: string; throughSignalKey: string }
  ) => Promise<{ deletedCount: number; hasMore: boolean }>;
};

function chatroomId(value: string): Id<'chatroom_rooms'> {
  return value as Id<'chatroom_rooms'>;
}

// fallow-ignore-next-line complexity
function signalPage(result: unknown): OperationalSignalPage | null {
  if (!result || typeof result !== 'object') return null;
  const page = result as {
    items?: readonly OperationalStatusSignal[];
    highKey?: string | null;
  };
  if (!page.items?.length || !page.highKey) return null;
  return {
    items: page.items,
    afterSignalKey: '',
    highSignalKey: page.highKey,
  };
}

function createFeed(input: {
  kind: OperationalSignalKind;
  subscribe: OperationalSignalFeed['subscribe'];
  hydrate: OperationalSignalFeed['hydrate'];
  acknowledge: OperationalSignalFeed['acknowledge'];
}): OperationalSignalFeed {
  return input;
}

function subscribeArgs(input: {
  sessionId: SessionId;
  machineId: string;
  chatroomId: string;
  afterKey: string;
  limit: number;
}) {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: chatroomId(input.chatroomId),
    afterKey: input.afterKey,
    limit: input.limit,
  };
}

function rangeArgs(input: {
  sessionId: SessionId;
  machineId: string;
  chatroomId: string;
  afterSignalKey: string;
  throughSignalKey: string;
  limit: number;
}) {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: chatroomId(input.chatroomId),
    afterSignalKey: input.afterSignalKey,
    throughSignalKey: input.throughSignalKey,
    limit: input.limit,
  };
}

function ackArgs(input: {
  sessionId: SessionId;
  machineId: string;
  chatroomId: string;
  throughSignalKey: string;
}) {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: chatroomId(input.chatroomId),
    throughSignalKey: input.throughSignalKey,
  };
}

const createMachineFeed = (config: {
  kind: OperationalSignalKind;
  subscribe: typeof api.machines.subscribeMachineAgentOperationalSignalsSince;
  hydrate: typeof api.machines.listMachineAgentOperationalStatusForSignalRange;
  acknowledge: typeof api.machines.ackMachineAgentOperationalSignals;
}): OperationalSignalFeed =>
  createFeed({
    kind: config.kind,
    subscribe: (client, input, onResult, onError) =>
      client.onUpdate(
        config.subscribe,
        subscribeArgs(input),
        (result) => {
          const page = signalPage(result);
          onResult(page ? { ...page, afterSignalKey: input.afterKey } : result);
        },
        onError
      ),
    hydrate: async (client, input) =>
      (await client.query(config.hydrate, rangeArgs(input))) as OperationalSignalHydration,
    acknowledge: async (sessionDeps, input) =>
      (await sessionDeps.backend.mutation(
        config.acknowledge,
        ackArgs({
          ...input,
          sessionId: sessionDeps.sessionId as SessionId,
        })
      )) as { deletedCount: number; hasMore: boolean },
  });

export const operationalSignalFeeds: Record<OperationalSignalKind, OperationalSignalFeed> = {
  'agent-operational': createMachineFeed({
    kind: 'agent-operational',
    subscribe: api.machines.subscribeMachineAgentOperationalSignalsSince,
    hydrate: api.machines.listMachineAgentOperationalStatusForSignalRange,
    acknowledge: api.machines.ackMachineAgentOperationalSignals,
  }),
  'agent-stop': createMachineFeed({
    kind: 'agent-stop',
    subscribe: api.machines.subscribeMachineAgentStopSignalsSince,
    hydrate: api.machines.listMachineAgentStopStatusForSignalRange,
    acknowledge: api.machines.ackMachineAgentStopSignals,
  }),
};
