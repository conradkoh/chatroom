/**
 * Use Case: Subscribe assigned-task signals from snapshot projection (indexed cursor).
 */

import type {
  SubscribeAssignedTaskSignalsInput,
  SubscribeAssignedTaskSignalsResult,
} from './assigned-tasks-types';
import { subscribeAssignedTaskSignalsFromSnapshots } from './machine-assigned-task-snapshot-read';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { SubscribeAssignedTaskSignalsResult } from './assigned-tasks-types';

export async function subscribeAssignedTaskSignalsForMachine(
  ctx: QueryCtx,
  input: SubscribeAssignedTaskSignalsInput
): Promise<SubscribeAssignedTaskSignalsResult> {
  return subscribeAssignedTaskSignalsFromSnapshots(ctx, input);
}
