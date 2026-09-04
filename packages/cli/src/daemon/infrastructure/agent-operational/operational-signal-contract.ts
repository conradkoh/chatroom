// fallow-ignore-file code-duplication
/**
 * Typed argument builders for the machine operational-signal contract.
 *
 * Every builder returns the exact argument type generated for its Convex
 * function, so a backend validator change (for example a removed `chatroomId`)
 * fails compilation here instead of drifting at runtime.
 */

import type { FunctionArgs } from 'convex/server';

import type { api, Id } from '../../../api.js';

export type SubscribeMachineOperationalSignalsSinceArgs = FunctionArgs<
  typeof api.machines.subscribeMachineOperationalSignalsSince
>;
export type ListOperationalStatusForMachineSignalRangeArgs = FunctionArgs<
  typeof api.machines.listOperationalStatusForMachineSignalRange
>;
export type AckMachineOperationalSignalsArgs = FunctionArgs<
  typeof api.machines.ackMachineOperationalSignals
>;

function asChatroomId(chatroomId: string): Id<'chatroom_rooms'> {
  // CLI command/session boundaries expose Convex IDs as strings; the generated
  // FunctionArgs type keeps the cast limited to this one validated boundary.
  return chatroomId as Id<'chatroom_rooms'>;
}

export function buildSubscribeMachineOperationalSignalsSinceArgs(input: {
  sessionId: SubscribeMachineOperationalSignalsSinceArgs['sessionId'];
  machineId: SubscribeMachineOperationalSignalsSinceArgs['machineId'];
  chatroomId: string;
  afterKey: SubscribeMachineOperationalSignalsSinceArgs['afterKey'];
  limit: SubscribeMachineOperationalSignalsSinceArgs['limit'];
}): SubscribeMachineOperationalSignalsSinceArgs {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: asChatroomId(input.chatroomId),
    afterKey: input.afterKey,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

export function buildListOperationalStatusForMachineSignalRangeArgs(input: {
  sessionId: ListOperationalStatusForMachineSignalRangeArgs['sessionId'];
  machineId: ListOperationalStatusForMachineSignalRangeArgs['machineId'];
  chatroomId: string;
  afterSignalKey: ListOperationalStatusForMachineSignalRangeArgs['afterSignalKey'];
  throughSignalKey: ListOperationalStatusForMachineSignalRangeArgs['throughSignalKey'];
  limit: ListOperationalStatusForMachineSignalRangeArgs['limit'];
}): ListOperationalStatusForMachineSignalRangeArgs {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: asChatroomId(input.chatroomId),
    afterSignalKey: input.afterSignalKey,
    throughSignalKey: input.throughSignalKey,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

export function buildAckMachineOperationalSignalsArgs(input: {
  sessionId: AckMachineOperationalSignalsArgs['sessionId'];
  machineId: AckMachineOperationalSignalsArgs['machineId'];
  chatroomId: string;
  throughSignalKey: AckMachineOperationalSignalsArgs['throughSignalKey'];
}): AckMachineOperationalSignalsArgs {
  return {
    sessionId: input.sessionId,
    machineId: input.machineId,
    chatroomId: asChatroomId(input.chatroomId),
    throughSignalKey: input.throughSignalKey,
  };
}
