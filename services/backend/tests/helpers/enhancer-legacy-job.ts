import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

/** Insert a legacy enhancer job row for daemon API integration tests. */
export async function insertLegacyEnhancerJob(args: {
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
  machineId: string;
  originUserMessageId?: Id<'chatroom_messages'>;
  status?: 'pending' | 'running';
  draftContent?: string;
}): Promise<{ jobId: Id<'chatroom_enhancerJobs'>; taskId: Id<'chatroom_tasks'> }> {
  return t.run(async (ctx) => {
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy: 'user',
      content: args.draftContent ?? 'Legacy enhancer task',
      status: 'in_progress',
      assignedTo: 'enhancer',
      sourceMessageId: args.originUserMessageId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 1,
    });
    const jobId = await ctx.db.insert('chatroom_enhancerJobs', {
      chatroomId: args.chatroomId,
      userId: args.userId,
      targetId: 'handoff:planner-to-builder',
      fromRole: 'planner',
      toRole: 'builder',
      status: args.status ?? 'pending',
      draftContent: args.draftContent ?? 'Draft',
      templateSnapshot: '# Template\n## Goal',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId: args.machineId,
      workingDir: '/home/test/repo',
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: Date.now(),
      runningSince: args.status === 'running' ? Date.now() : undefined,
      taskId,
      originUserMessageId: args.originUserMessageId,
      pendingHandoffArgs: {
        senderRole: 'enhancer',
        targetRole: 'planner',
      },
    });
    return { jobId, taskId };
  });
}
