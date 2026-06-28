/**
 * Use Case: Get Assigned Tasks for Machine
 *
 * @deprecated Use listAssignedTasksLite + pollAssignedTaskSignalsSince + getAssignedTaskForAction.
 * Retained temporarily for debugging; removed after task-monitor migration.
 */

import { mapAssignedTasksForMachine, rowToFullView } from './assigned-tasks-core';
import type { GetAssignedTasksInput, GetAssignedTasksResult } from './assigned-tasks-types';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type {
  AssignedTaskView,
  GetAssignedTasksInput,
  GetAssignedTasksResult,
} from './assigned-tasks-types';

export async function getAssignedTasksForMachine(
  ctx: QueryCtx,
  input: GetAssignedTasksInput
): Promise<GetAssignedTasksResult> {
  return mapAssignedTasksForMachine(ctx, input, rowToFullView);
}
