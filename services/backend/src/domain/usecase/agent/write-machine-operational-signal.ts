import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// fallow-ignore-next-line unused-export
export function buildMachineOperationalSignalKey(
  projectedAt: number,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): string {
  return `${String(projectedAt).padStart(16, '0')}:${chatroomId}:${role.toLowerCase()}`;
}

type SignalTable =
  | 'chatroom_machineAgentOperationalSignals'
  | 'chatroom_machineConnectivitySignals'
  | 'chatroom_machineAgentStopSignals'
  | 'chatroom_machineAgentRemovalSignals';

async function writeMachineSignal(
  ctx: MutationCtx,
  input: {
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    revisionKey: string;
    projectedAt: number;
  },
  table: SignalTable
): Promise<void> {
  const role = input.role.toLowerCase();
  const signalKey = buildMachineOperationalSignalKey(input.projectedAt, input.chatroomId, role);
  const signal = {
    machineId: input.machineId,
    chatroomId: input.chatroomId,
    role,
    revisionKey: input.revisionKey,
    signalKey,
    projectedAt: input.projectedAt,
  };
  await ctx.db.insert(table, signal);
}

export async function writeMachineAgentOperationalSignal(
  ctx: MutationCtx,
  input: {
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    revisionKey: string;
    projectedAt: number;
  }
): Promise<void> {
  await writeMachineSignal(ctx, input, 'chatroom_machineAgentOperationalSignals');
}

export async function writeMachineConnectivitySignal(
  ctx: MutationCtx,
  input: {
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    revisionKey: string;
    projectedAt: number;
  }
): Promise<void> {
  await writeMachineSignal(ctx, input, 'chatroom_machineConnectivitySignals');
}

export async function writeMachineAgentStopSignal(
  ctx: MutationCtx,
  input: {
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    revisionKey: string;
    projectedAt: number;
  }
): Promise<void> {
  await writeMachineSignal(ctx, input, 'chatroom_machineAgentStopSignals');
}

export async function writeMachineAgentRemovalSignal(
  ctx: MutationCtx,
  input: {
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    revisionKey: string;
    projectedAt: number;
  }
): Promise<void> {
  await writeMachineSignal(ctx, input, 'chatroom_machineAgentRemovalSignals');
}
