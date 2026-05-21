import type { MutationCtx } from '../_generated/server';
import { syncCommands } from './process/sync';
import { updateRunStatus, clearStaleRuns, clearStuckRuns } from './process/run-status';

export async function handleSyncCommands(
  ctx: MutationCtx,
  args: Parameters<typeof syncCommands>[1]
) {
  return syncCommands(ctx, args);
}

export async function handleUpdateRunStatus(
  ctx: MutationCtx,
  args: Parameters<typeof updateRunStatus>[1]
) {
  return updateRunStatus(ctx, args);
}

export async function handleClearStaleCommandRuns(
  ctx: MutationCtx,
  args: Parameters<typeof clearStaleRuns>[1]
) {
  return clearStaleRuns(ctx, args);
}

export async function handleClearStuckCommandRuns(
  ctx: MutationCtx,
  args: Parameters<typeof clearStuckRuns>[1]
) {
  return clearStuckRuns(ctx, args);
}
