/**
 * Use Case: Fetch one assigned task with full content for daemon action (nudge/inject).
 */

import type { AssignedTaskView, GetAssignedTaskForActionInput } from './assigned-tasks-types';
import { getAssignedTaskForActionFromSnapshots } from './machine-assigned-task-snapshot-read';
import type { QueryCtx } from '../../../../convex/_generated/server';

export async function getAssignedTaskForAction(
  ctx: QueryCtx,
  input: GetAssignedTaskForActionInput
): Promise<AssignedTaskView | null> {
  return getAssignedTaskForActionFromSnapshots(ctx, input);
}
