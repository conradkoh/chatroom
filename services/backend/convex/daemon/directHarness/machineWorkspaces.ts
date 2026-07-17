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

/**
 * Load machine workspaces or return `onEmpty` when none are registered.
 * Shared scaffold for daemon machine-scoped queries.
 */
export async function withMachineWorkspaces<T>(
  ctx: QueryCtx,
  sessionId: string,
  machineId: string,
  onEmpty: T,
  run: (workspaces: Doc<'chatroom_workspaces'>[]) => Promise<T>
): Promise<T> {
  const workspaces = await requireMachineWorkspaces(ctx, sessionId, machineId);
  if (workspaces.length === 0) return onEmpty;
  return run(workspaces);
}
