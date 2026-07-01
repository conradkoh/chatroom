import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { buildTeamRoleKey } from './utils/teamRoleKey';
import { assertMachineBelongsToChatroom } from '../src/domain/usecase/agent/assert-machine-belongs-to-chatroom';
import { transitionAgentStatus } from '../src/domain/usecase/agent/transition-agent-status';
import { patchTeamAgentConfig } from '../src/domain/usecase/machine/patch-team-agent-config';

/** Emits agent.resumeStormAborted when rapid agent_end events abort in-process auto-resume. */
export const emitResumeStormAborted = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    reason: v.union(
      v.literal('unknown'),
      v.literal('auth_error'),
      v.literal('rate_limit'),
      v.literal('config_error')
    ),
    endCount: v.number(),
    windowMs: v.number(),
    harnessSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.resumeStormAborted',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      reason: args.reason,
      endCount: args.endCount,
      windowMs: args.windowMs,
      harnessSessionId: args.harnessSessionId,
      timestamp: Date.now(),
    });

    await transitionAgentStatus(
      ctx,
      args.chatroomId,
      args.role,
      'agent.resumeStormAborted',
      'stopped'
    );

    const stormChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (stormChatroom?.teamId) {
      const stormTeamRoleKey = buildTeamRoleKey(stormChatroom._id, stormChatroom.teamId, args.role);
      const stormConfig = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', stormTeamRoleKey))
        .first();
      if (stormConfig) {
        await patchTeamAgentConfig(
          ctx,
          stormConfig._id,
          {
            desiredState: 'stopped',
            spawnedAgentPid: undefined,
            spawnedAt: undefined,
          },
          { projectScope: 'chatroom' }
        );
      }
    }

    return { success: true };
  },
});
