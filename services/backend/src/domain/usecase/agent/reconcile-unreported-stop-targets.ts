import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function reconcileUnreportedStopTargets(_ctx: MutationCtx, _args: { stopCommandId: Id<'chatroom_agentStopCommands'>; machineId: string; reportedTargetKeys: Set<string> }): Promise<void> {
  // Deprecated: slice 4 removes daemon reconcile path. Do not fabricate already_stopped.
}
