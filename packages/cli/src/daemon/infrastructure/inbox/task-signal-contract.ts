// fallow-ignore-file code-duplication
/**
 * Typed argument builders for the task-status signal contract.
 *
 * Every builder returns the exact argument type generated for its Convex
 * function, so a backend validator change (for example a removed or renamed
 * `chatroomId`) fails compilation here instead of drifting at runtime.
 */

import type { FunctionArgs } from 'convex/server';

import type { api, Id } from '../../../api.js';

export type SubscribeTaskStatusSignalsSinceArgs = FunctionArgs<
  typeof api.messageList.subscribeTaskStatusSignalsSince
>;
export type ListTasksForMachineSignalRangeArgs = FunctionArgs<
  typeof api.tasks.listTasksForMachineSignalRange
>;

function asChatroomId(chatroomId: string): Id<'chatroom_rooms'> {
  // CLI command/session boundaries expose Convex IDs as strings; the generated
  // FunctionArgs type keeps the cast limited to this one validated boundary.
  return chatroomId as Id<'chatroom_rooms'>;
}

export function buildSubscribeTaskStatusSignalsSinceArgs(input: {
  sessionId: SubscribeTaskStatusSignalsSinceArgs['sessionId'];
  machineId: SubscribeTaskStatusSignalsSinceArgs['machineId'];
  chatroomId: string;
  afterKey: SubscribeTaskStatusSignalsSinceArgs['afterKey'];
  limit: SubscribeTaskStatusSignalsSinceArgs['limit'];
}): SubscribeTaskStatusSignalsSinceArgs {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: asChatroomId(input.chatroomId),
    afterKey: input.afterKey,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

export function buildListTasksForMachineSignalRangeArgs(input: {
  sessionId: ListTasksForMachineSignalRangeArgs['sessionId'];
  machineId: ListTasksForMachineSignalRangeArgs['machineId'];
  chatroomId: string;
  afterSignalKey: ListTasksForMachineSignalRangeArgs['afterSignalKey'];
  throughSignalKey: ListTasksForMachineSignalRangeArgs['throughSignalKey'];
  limit: ListTasksForMachineSignalRangeArgs['limit'];
}): ListTasksForMachineSignalRangeArgs {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: asChatroomId(input.chatroomId),
    afterSignalKey: input.afterSignalKey,
    throughSignalKey: input.throughSignalKey,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}
