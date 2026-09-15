import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { clearTaskDeliveryFailure } from '../../src/domain/usecase/machine/clear-task-delivery-failure';
import { listAssignedTaskStatusForMachine } from '../../src/domain/usecase/machine/list-assigned-task-status-for-machine';
import { recordTaskDeliveryFailure } from '../../src/domain/usecase/machine/record-task-delivery-failure';
import { mutation, query } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';

/** Authoritative deliverable task statuses for daemon boot recovery/watchers. */
export const listActive = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return listAssignedTaskStatusForMachine(ctx, { machineId: args.machineId });
  },
});

export const clearDeliveryFailure = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return clearTaskDeliveryFailure(ctx, { taskId: args.taskId });
  },
});

export const recordDeliveryFailure = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    taskId: v.id('chatroom_tasks'),
    reason: v.union(
      v.literal('no_agent_config'),
      v.literal('unsupported_harness'),
      v.literal('injection_not_confirmed'),
      v.literal('task_not_deliverable'),
      v.literal('assigned_elsewhere')
    ),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return recordTaskDeliveryFailure(ctx, {
      taskId: args.taskId,
      reason: args.reason,
      occurredAt: Date.now(),
    });
  },
});
