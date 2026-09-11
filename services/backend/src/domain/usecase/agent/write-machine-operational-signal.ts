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

type MachineSignalInput = {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  revisionKey: string;
  projectedAt: number;
};

function baseMachineSignal(input: MachineSignalInput) {
  const role = input.role.toLowerCase();
  const signalKey = buildMachineOperationalSignalKey(input.projectedAt, input.chatroomId, role);
  return {
    machineId: input.machineId,
    chatroomId: input.chatroomId,
    role,
    revisionKey: input.revisionKey,
    signalKey,
    projectedAt: input.projectedAt,
  };
}

export async function writeMachineAgentOperationalSignal(
  ctx: MutationCtx,
  input: MachineSignalInput
): Promise<void> {
  await ctx.db.insert('chatroom_machineAgentOperationalSignals', {
    ...baseMachineSignal(input),
    kind: 'agent-operational',
  });
}
