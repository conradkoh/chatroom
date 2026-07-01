/**
 * Use Case: List machine assigned-task snapshots for daemon hydrate.
 */

import type {
  ListMachineAssignedTaskSnapshotsResult,
  MachineAssignedTasksInput,
} from './assigned-tasks-types';
import { listMachineAssignedTaskSnapshotsForMachine } from './machine-assigned-task-snapshot-read';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { ListMachineAssignedTaskSnapshotsResult } from './assigned-tasks-types';

export async function listMachineAssignedTaskSnapshots(
  ctx: QueryCtx,
  input: MachineAssignedTasksInput
): Promise<ListMachineAssignedTaskSnapshotsResult> {
  return listMachineAssignedTaskSnapshotsForMachine(ctx, input);
}
