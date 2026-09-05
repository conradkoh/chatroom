import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it } from 'vitest';

import {
  buildListTasksForMachineSignalRangeArgs,
  buildSubscribeTaskStatusSignalsSinceArgs,
  type ListTasksForMachineSignalRangeArgs,
  type SubscribeTaskStatusSignalsSinceArgs,
} from './task-signal-contract';

const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';
const CHATROOM_ID = 'room-1';

type HasChatroomId<Args> = 'chatroomId' extends keyof Args ? true : false;

describe('task-signal-contract builders', () => {
  it('requires chatroomId in every generated function contract', () => {
    const _chatroomIdRequiredInEveryContract: {
      readonly subscribe: HasChatroomId<SubscribeTaskStatusSignalsSinceArgs>;
      readonly hydrate: HasChatroomId<ListTasksForMachineSignalRangeArgs>;
    } = { subscribe: true, hydrate: true };

    expect(_chatroomIdRequiredInEveryContract).toEqual({ subscribe: true, hydrate: true });
  });

  it('builds subscribe args with room id, cursor, and page limit', () => {
    const args = buildSubscribeTaskStatusSignalsSinceArgs({
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
    const args = buildSubscribeTaskStatusSignalsSinceArgs({
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
    const args = buildListTasksForMachineSignalRangeArgs({
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
    const args = buildListTasksForMachineSignalRangeArgs({
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
