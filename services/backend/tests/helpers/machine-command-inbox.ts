import { expect } from 'vitest';

import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

const COMMAND_EVENT_TYPES = [
  'agent.requestStart',
  'agent.restart',
  'agent.requestStop',
  'daemon.ping',
  'daemon.gitRefresh',
  'daemon.refreshCapabilities',
  'daemon.localAction',
  'daemon.pickFolder',
] as const;

export async function getMachineCommandInbox(machineId: string) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'pending')
      )
      .collect()
  );
}

export async function getMachineCommandInboxAll(machineId: string) {
  return t.run(async (ctx) => [
    ...(await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'pending')
      )
      .collect()),
    ...(await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'processing')
      )
      .collect()),
  ]);
}

export async function assertNoCommandVariantsOnEventStream(chatroomId: Id<'chatroom_rooms'>) {
  const commandEvents = await t.run(async (ctx) =>
    (
      await ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    ).filter((e) => COMMAND_EVENT_TYPES.includes(e.type as never))
  );
  expect(commandEvents).toEqual([]);
}
