/**
 * Use Case: Subscribe assigned-task presence deltas from snapshot projection.
 */

import type {
  SubscribeAssignedTaskPresenceInput,
  SubscribeAssignedTaskPresenceResult,
} from './assigned-tasks-types';
import { subscribeAssignedTaskPresenceFromSnapshots } from './machine-assigned-task-snapshot-read';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { SubscribeAssignedTaskPresenceResult } from './assigned-tasks-types';

export async function subscribeAssignedTaskPresenceForMachine(
  ctx: QueryCtx,
  input: SubscribeAssignedTaskPresenceInput
): Promise<SubscribeAssignedTaskPresenceResult> {
  return subscribeAssignedTaskPresenceFromSnapshots(ctx, input);
}
