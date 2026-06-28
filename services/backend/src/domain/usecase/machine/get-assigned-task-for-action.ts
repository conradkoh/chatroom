/**
 * Use Case: Fetch one assigned task with full content for daemon action (nudge/inject).
 */

import {
  collectAssignedTaskRows,
  loadMachineAssignedTaskContext,
  rowToFullView,
} from './assigned-tasks-core';
import type { AssignedTaskView, GetAssignedTaskForActionInput } from './assigned-tasks-types';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { AssignedTaskView } from './assigned-tasks-types';

export async function getAssignedTaskForAction(
  ctx: QueryCtx,
  input: GetAssignedTaskForActionInput
): Promise<AssignedTaskView | null> {
  const context = await loadMachineAssignedTaskContext(ctx, input.machineId, input.userId);
  if (!context) {
    return null;
  }

  const rows = await collectAssignedTaskRows(ctx, context);
  const match = rows.find(
    (row) =>
      row.task._id === input.taskId && row.config.role.toLowerCase() === input.role.toLowerCase()
  );
  if (!match) {
    return null;
  }

  return rowToFullView(match, input.machineId);
}
