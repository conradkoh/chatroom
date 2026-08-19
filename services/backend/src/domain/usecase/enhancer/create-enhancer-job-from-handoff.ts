import { ENHANCER_MAX_ATTEMPTS } from '../../../../config/reliability';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import {
  emitEnhancerEvent,
  resolveHandoffTemplateSnapshot,
  resolveWorkspaceForEnhancer,
} from '../../../../convex/web/enhancer/internal';

export interface CreateEnhancerJobFromHandoffArgs {
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
  chatroom: Doc<'chatroom_rooms'>;
  entryPointRole: string;
  content: string;
  taskId: Id<'chatroom_tasks'>;
  messageId: Id<'chatroom_messages'>;
  originUserMessageId?: Id<'chatroom_messages'>;
  attachedArtifactIds?: Id<'chatroom_artifacts'>[];
  machineId: string;
  agentHarness: Doc<'chatroom_enhancerConfigs'>['agentHarness'];
  model: string;
}

/** Creates a daemon-spawned enhancer job linked to the handoff task row. */
export async function createEnhancerJobFromHandoff(
  ctx: MutationCtx,
  args: CreateEnhancerJobFromHandoffArgs
): Promise<Id<'chatroom_enhancerJobs'>> {
  const workspace = await resolveWorkspaceForEnhancer(ctx, args.chatroomId, args.machineId);
  const templateSnapshot = resolveHandoffTemplateSnapshot(
    args.chatroom,
    args.chatroomId,
    args.entryPointRole
  );
  const now = Date.now();

  const jobId = await ctx.db.insert('chatroom_enhancerJobs', {
    chatroomId: args.chatroomId,
    userId: args.userId,
    targetId: 'handoff:planner-to-builder',
    fromRole: args.entryPointRole,
    toRole: 'enhancer',
    status: 'pending',
    draftContent: args.content,
    templateSnapshot,
    agentHarness: args.agentHarness,
    model: args.model,
    machineId: args.machineId,
    workingDir: workspace.workingDir,
    attemptCount: 1,
    maxAttempts: ENHANCER_MAX_ATTEMPTS,
    createdAt: now,
    originUserMessageId: args.originUserMessageId,
    taskId: args.taskId,
    handoffMessageId: args.messageId,
    pendingHandoffArgs: {
      senderRole: args.entryPointRole,
      targetRole: args.entryPointRole,
      attachedArtifactIds: args.attachedArtifactIds,
    },
  });

  await emitEnhancerEvent(
    ctx,
    {
      type: 'enhancer.job.created' as const,
      chatroomId: args.chatroomId,
      jobId,
      userId: args.userId,
      attemptCount: 1,
      maxAttempts: ENHANCER_MAX_ATTEMPTS,
    },
    now
  );

  return jobId;
}
