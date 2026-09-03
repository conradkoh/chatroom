import { upsertMachineOperationalSignalHead } from './project-machine-operational-signal-head';
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

export async function writeMachineOperationalSignal(
  ctx: MutationCtx,
  input: {
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    revisionKey: string;
    projectedAt: number;
    removed?: boolean | undefined;
  }
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
    ...(input.removed ? { removed: true } : {}),
  };
  await ctx.db.insert('chatroom_machineOperationalSignals', signal);
  const { machineId, ...headSignal } = signal;
  await upsertMachineOperationalSignalHead(ctx, input.machineId, headSignal);
}
