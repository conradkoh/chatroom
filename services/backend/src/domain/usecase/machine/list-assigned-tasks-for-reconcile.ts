/**
 * Use Case: List assigned-task reconcile snapshots for machine daemon polls.
 *
 * Returns snapshot rows without task.content in the response. Same collect path
 * as action fetch; does not reduce server-side document reads.
 */

import { mapAssignedTasksForMachine, rowToSnapshotView } from './assigned-tasks-core';
import type {
  ListAssignedTasksForReconcileResult,
  MachineAssignedTasksInput,
} from './assigned-tasks-types';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { ListAssignedTasksForReconcileResult } from './assigned-tasks-types';

export async function listAssignedTasksForReconcileForMachine(
  ctx: QueryCtx,
  input: MachineAssignedTasksInput
): Promise<ListAssignedTasksForReconcileResult> {
  return mapAssignedTasksForMachine(ctx, input, rowToSnapshotView);
}
