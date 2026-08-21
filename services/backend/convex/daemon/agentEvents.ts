/** Daemon-facing agent lifecycle event endpoints (state only — no event-stream inserts). */
// fallow-ignore-file code-duplication

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { agentExited as agentExitedUseCase } from '../../src/domain/usecase/agent/agent-exited';
import { assertMachineBelongsToChatroom } from '../../src/domain/usecase/agent/assert-machine-belongs-to-chatroom';
import { recordAgentSpawnedState } from '../../src/domain/usecase/agent/record-agent-spawned-state';
import { transitionAgentStatus } from '../../src/domain/usecase/agent/transition-agent-status';
import { patchTeamAgentConfig } from '../../src/domain/usecase/machine/patch-team-agent-config';
import { consumeTaskStartInNewSession } from '../../src/domain/usecase/task/consume-task-start-in-new-session';
import { onAgentExited } from '../../src/events/agent/on-agent-exited';
import { mutation } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';
import { buildTeamRoleKey } from '../utils/teamRoleKey';

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

/** Applies participant + restart-metric state when a daemon-spawned agent starts. */
export const agentStarted = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    pid: v.number(),
    model: v.optional(v.string()),
    reason: v.optional(v.string()),
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

    await recordAgentSpawnedState(ctx, args);
    return { success: true };
  },
});

/** Transitions participant to startFailed and resets desiredState. */
export const agentStartFailed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.startFailed', 'stopped');

    const failedChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (failedChatroom?.teamId) {
      const failedTeamRoleKey = buildTeamRoleKey(
        failedChatroom._id,
        failedChatroom.teamId,
        args.role
      );
      const failedConfig = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', failedTeamRoleKey))
        .first();
      if (failedConfig) {
        await patchTeamAgentConfig(ctx, failedConfig._id, { desiredState: 'stopped' });
      }
    }

    return { success: true };
  },
});

/** Transitions participant for provider-unavailable failures. */
export const agentProviderUnavailable = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    reason: v.union(v.literal('model_capacity'), v.literal('rate_limit'), v.literal('quota')),
    model: v.string(),
    message: v.string(),
    recoverable: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await transitionAgentStatus(
      ctx,
      args.chatroomId,
      args.role,
      'agent.providerUnavailable',
      args.recoverable ? undefined : 'stopped'
    );

    if (!args.recoverable) {
      const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
      if (chatroom?.teamId) {
        const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role);
        const config = await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
          .first();
        if (config) {
          await patchTeamAgentConfig(ctx, config._id, { desiredState: 'stopped' });
        }
      }
    }

    return { success: true };
  },
});

export const sessionResumeRequested = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentHarness: v.string(),
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

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.sessionResumeRequested');
    return { success: true };
  },
});

export const sessionResumed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
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

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.sessionResumed');
    return { success: true };
  },
});

export const sessionResumeFailed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    reason: v.string(),
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

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.sessionResumeFailed');
    return { success: true };
  },
});

export const sessionReopenRetry = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    attempt: v.number(),
    maxAttempts: v.number(),
    error: v.optional(v.string()),
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

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.sessionReopenRetry');
    return { success: true };
  },
});

export const sessionAugmented = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.id('chatroom_tasks'),
    mode: v.union(v.literal('none'), v.literal('new_session')),
    newSessionStarted: v.boolean(),
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

    if (args.newSessionStarted) {
      await consumeTaskStartInNewSession(ctx, args.taskId);
    }

    return { success: true };
  },
});
