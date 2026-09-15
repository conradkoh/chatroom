import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { listAssignedTaskStatusForMachine } from '../../src/domain/usecase/machine/list-assigned-task-status-for-machine';
import { query } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';

/** Authoritative deliverable task statuses for daemon boot recovery/watchers. */
export const listActive = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return listAssignedTaskStatusForMachine(ctx, { machineId: args.machineId });
  },
});
