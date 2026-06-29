/**
 * Use Case: List assigned tasks (lite) for machine daemon reconcile polls.
 *
 * Same pairing logic as listAssignedTasksLite but omits task.content in the view mapper.
 */

import { mapAssignedTasksForMachine, rowToLiteView } from './assigned-tasks-core';
import type {
  MachineAssignedTasksInput,
  ListAssignedTasksLiteResult,
} from './assigned-tasks-types';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { ListAssignedTasksLiteResult } from './assigned-tasks-types';

export async function listAssignedTasksLiteForMachine(
  ctx: QueryCtx,
  input: MachineAssignedTasksInput
): Promise<ListAssignedTasksLiteResult> {
  return mapAssignedTasksForMachine(ctx, input, rowToLiteView);
}
