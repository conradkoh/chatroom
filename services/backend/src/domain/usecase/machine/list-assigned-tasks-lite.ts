/**
 * Use Case: List assigned tasks (lite) for machine daemon reconcile polls.
 *
 * Same pairing logic as getAssignedTasks but omits task.content.
 */

import { mapAssignedTasksForMachine, rowToLiteView } from './assigned-tasks-core';
import type { GetAssignedTasksInput, ListAssignedTasksLiteResult } from './assigned-tasks-types';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { ListAssignedTasksLiteResult } from './assigned-tasks-types';

export async function listAssignedTasksLiteForMachine(
  ctx: QueryCtx,
  input: GetAssignedTasksInput
): Promise<ListAssignedTasksLiteResult> {
  return mapAssignedTasksForMachine(ctx, input, rowToLiteView);
}
