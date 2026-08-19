/** Daemon-facing agent lifecycle event endpoints. */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';
import { agentExited as agentExitedUseCase } from '../../src/domain/usecase/agent/agent-exited';
import { onAgentExited } from '../../src/events/agent/on-agent-exited';

/** Records an agent exit and applies the corresponding backend state cleanup. */
export const agentExited = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    pid: v.number(),
    stopReason: v.optional(v.string()),
    stopSignal: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    signal: v.optional(v.string()),
    agentHarness: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    await agentExitedUseCase(ctx, args);
    await onAgentExited(ctx, args);

    return { success: true };
  },
});
