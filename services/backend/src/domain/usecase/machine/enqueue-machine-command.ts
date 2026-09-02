import type { MutationCtx } from '../../../../convex/_generated/server';
import { MACHINE_COMMAND_TTL_MS, type MachineCommandPayload } from '../../entities/machine-command';

export interface EnqueueMachineCommandInput {
  machineId: string;
  command: MachineCommandPayload;
  now?: number | undefined;
}

/** Insert a pending command, deriving its deadline from the command type. */
export async function enqueueMachineCommand(ctx: MutationCtx, input: EnqueueMachineCommandInput) {
  const now = input.now ?? Date.now();
  return await ctx.db.insert('chatroom_machineCommandInbox', {
    machineId: input.machineId,
    command: input.command,
    createdAt: now,
    deadline: now + MACHINE_COMMAND_TTL_MS[input.command.type],
    attemptCount: 0,
    status: 'pending',
  });
}
