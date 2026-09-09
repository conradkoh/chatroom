import type { FunctionArgs } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it } from 'vitest';

import {
  buildListTasksForMachineTaskDeliverySignalRangeArgs,
  buildSubscribeTaskDeliverySignalsSinceArgs,
  type ListTasksForMachineTaskDeliverySignalRangeArgs,
  type SubscribeTaskDeliverySignalsSinceArgs,
} from './task-signal-contract';
import type { api } from '../../../api.js';

const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';
const CHATROOM_ID = 'room-1';

type HasChatroomId<Args> = 'chatroomId' extends keyof Args ? true : false;

type GeneratedSubscribeArgs = FunctionArgs<
  typeof api.taskDelivery.subscribeTaskDeliverySignalsSince
>;
type GeneratedHydrateArgs = FunctionArgs<
  typeof api.taskDelivery.listTasksForMachineTaskDeliverySignalRange
>;

describe('task-signal-contract builders', () => {
  it('requires chatroomId in every generated function contract', () => {
    const _chatroomIdRequiredInEveryContract: {
      readonly subscribe: HasChatroomId<SubscribeTaskDeliverySignalsSinceArgs>;
      readonly hydrate: HasChatroomId<ListTasksForMachineTaskDeliverySignalRangeArgs>;
    } = { subscribe: true, hydrate: true };

    expect(_chatroomIdRequiredInEveryContract).toEqual({ subscribe: true, hydrate: true });
  });

  it('aliases the generated daemon taskDelivery contracts', () => {
    // Compile-time proof that the contract aliases track the daemon-owned
    // endpoints (not the legacy messageList/tasks feed).
    const _subscribeAlias: GeneratedSubscribeArgs =
      null as unknown as SubscribeTaskDeliverySignalsSinceArgs;
    const _subscribeReverse: SubscribeTaskDeliverySignalsSinceArgs =
      null as unknown as GeneratedSubscribeArgs;
    const _hydrateAlias: GeneratedHydrateArgs =
      null as unknown as ListTasksForMachineTaskDeliverySignalRangeArgs;
    const _hydrateReverse: ListTasksForMachineTaskDeliverySignalRangeArgs =
      null as unknown as GeneratedHydrateArgs;

    expect(_subscribeAlias).toBeNull();
    expect(_subscribeReverse).toBeNull();
    expect(_hydrateAlias).toBeNull();
    expect(_hydrateReverse).toBeNull();
  });

  it('builds subscribe args with room id, cursor, and page limit', () => {
    const args = buildSubscribeTaskDeliverySignalsSinceArgs({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      chatroomId: CHATROOM_ID,
      afterKey: 'after-1',
      limit: 100,
    });

    expect(args).toEqual({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      chatroomId: CHATROOM_ID,
      afterKey: 'after-1',
      limit: 100,
    });
  });

  it('omits the optional limit when undefined', () => {
    const args = buildSubscribeTaskDeliverySignalsSinceArgs({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      chatroomId: CHATROOM_ID,
      afterKey: 'after-1',
      limit: undefined,
    });

    expect(args).toEqual({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      chatroomId: CHATROOM_ID,
      afterKey: 'after-1',
    });
    expect(args).not.toHaveProperty('limit');
  });

  it('builds hydration args with room id and cursor range', () => {
    const args = buildListTasksForMachineTaskDeliverySignalRangeArgs({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      chatroomId: CHATROOM_ID,
      afterSignalKey: 'after-1',
      throughSignalKey: 'through-2',
      limit: 500,
    });

    expect(args).toEqual({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      chatroomId: CHATROOM_ID,
      afterSignalKey: 'after-1',
      throughSignalKey: 'through-2',
      limit: 500,
    });
  });

  it('omits the optional hydration limit when undefined', () => {
    const args = buildListTasksForMachineTaskDeliverySignalRangeArgs({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      chatroomId: CHATROOM_ID,
      afterSignalKey: 'after-1',
      throughSignalKey: 'through-2',
      limit: undefined,
    });

    expect(args).toEqual({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      chatroomId: CHATROOM_ID,
      afterSignalKey: 'after-1',
      throughSignalKey: 'through-2',
    });
    expect(args).not.toHaveProperty('limit');
  });
});
