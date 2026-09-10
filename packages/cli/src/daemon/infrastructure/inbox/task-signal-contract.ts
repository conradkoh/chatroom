// fallow-ignore-file code-duplication
/**
 * Typed argument builders for the daemon task-delivery signal contract.
 *
 * Every builder returns the exact argument type generated for its Convex
 * function, so a backend validator change (for example a removed or renamed
 * `chatroomId`) fails compilation here instead of drifting at runtime.
 */

import type { FunctionArgs } from 'convex/server';

import type { api, Id } from '../../../api.js';

export type SubscribeTaskDeliverySignalsSinceArgs = FunctionArgs<
  typeof api.taskDelivery.subscribeTaskDeliverySignalsSince
>;
export type ListTasksForMachineTaskDeliverySignalRangeArgs = FunctionArgs<
  typeof api.taskDelivery.listTasksForMachineTaskDeliverySignalRange
>;

function asChatroomId(chatroomId: string): Id<'chatroom_rooms'> {
  // CLI command/session boundaries expose Convex IDs as strings; the generated
  // FunctionArgs type keeps the cast limited to this one validated boundary.
  return chatroomId as Id<'chatroom_rooms'>;
}

export function buildSubscribeTaskDeliverySignalsSinceArgs(input: {
  sessionId: SubscribeTaskDeliverySignalsSinceArgs['sessionId'];
  machineId: SubscribeTaskDeliverySignalsSinceArgs['machineId'];
  chatroomId: string;
  afterKey: SubscribeTaskDeliverySignalsSinceArgs['afterKey'];
  limit: SubscribeTaskDeliverySignalsSinceArgs['limit'];
}): SubscribeTaskDeliverySignalsSinceArgs {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: asChatroomId(input.chatroomId),
    afterKey: input.afterKey,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

export function buildListTasksForMachineTaskDeliverySignalRangeArgs(input: {
  sessionId: ListTasksForMachineTaskDeliverySignalRangeArgs['sessionId'];
  machineId: ListTasksForMachineTaskDeliverySignalRangeArgs['machineId'];
  chatroomId: string;
  afterSignalKey: ListTasksForMachineTaskDeliverySignalRangeArgs['afterSignalKey'];
  throughSignalKey: ListTasksForMachineTaskDeliverySignalRangeArgs['throughSignalKey'];
  limit: ListTasksForMachineTaskDeliverySignalRangeArgs['limit'];
}): ListTasksForMachineTaskDeliverySignalRangeArgs {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: asChatroomId(input.chatroomId),
    afterSignalKey: input.afterSignalKey,
    throughSignalKey: input.throughSignalKey,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}
