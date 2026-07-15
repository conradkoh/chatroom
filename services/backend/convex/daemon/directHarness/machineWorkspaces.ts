import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { requireDirectHarnessWorkers } from '../../api/directHarnessHelpers';
import { requireMachineOwner } from '../../auth/cli/machineAccess';

/** Authorize daemon access and load workspaces registered for a machine. */
export async function requireMachineWorkspaces(
  ctx: QueryCtx,
  sessionId: string,
  machineId: string
): Promise<Doc<'chatroom_workspaces'>[]> {
  requireDirectHarnessWorkers();
  await requireMachineOwner(ctx, sessionId, machineId);

  return ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine', (q) => q.eq('machineId', machineId))
    .collect();
}
