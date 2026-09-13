/** Daemon-facing agent lifecycle event endpoints (state only — no event-stream inserts). */
// fallow-ignore-file code-duplication

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { assertMachineBelongsToChatroom } from '../../src/domain/usecase/agent/assert-machine-belongs-to-chatroom';
import { consumeTaskStartInNewSession } from '../../src/domain/usecase/task/consume-task-start-in-new-session';
import { mutation } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';

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
