/**
 * Convex mutations for agent stop requests (Stage 1 stub — delegates to requestAgentStop).
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { agentStopReasonValidator } from '../src/domain/entities/agent';
import { requestAgentStop } from '../src/domain/usecase/agent/request-agent-stop';

export const request = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    role: v.string(),
    reason: v.optional(agentStopReasonValidator),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    await requestAgentStop(ctx, {
      machineId: args.machineId,
      chatroomId: args.chatroomId,
      role: args.role,
      reason: args.reason ?? 'user.stop',
    });

    return { ok: true as const };
  },
});
