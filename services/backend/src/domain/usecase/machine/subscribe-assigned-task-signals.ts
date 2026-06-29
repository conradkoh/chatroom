/**
 * Use Case: Subscribe assigned-task signals for machine daemon incremental feed.
 */

import {
  collectAssignedTaskRows,
  filterSignalsAfterKey,
  loadMachineAssignedTaskContext,
  rowToSignal,
} from './assigned-tasks-core';
import type {
  SubscribeAssignedTaskSignalsInput,
  SubscribeAssignedTaskSignalsResult,
} from './assigned-tasks-types';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { SubscribeAssignedTaskSignalsResult } from './assigned-tasks-types';

export async function subscribeAssignedTaskSignalsForMachine(
  ctx: QueryCtx,
  input: SubscribeAssignedTaskSignalsInput
): Promise<SubscribeAssignedTaskSignalsResult> {
  const context = await loadMachineAssignedTaskContext(ctx, input.machineId, input.userId);
  if (!context) {
    return { items: [], highKey: null, hasMore: false };
  }

  const rows = await collectAssignedTaskRows(ctx, context);
  const signals = rows
    .map((row) => rowToSignal(row))
    .filter((signal): signal is NonNullable<typeof signal> => signal !== undefined);

  return filterSignalsAfterKey(signals, input.afterKey, input.limit);
}
