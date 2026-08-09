// fallow-ignore-file code-duplication
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { getSession } from './auth/session';
import { ackOrchestrationIngress as ackOrchestrationIngressUsecase } from '../src/domain/usecase/orchestration/ack-orchestration-ingress';
import { enqueueOrchestrationIngressMessage } from '../src/domain/usecase/orchestration/enqueue-orchestration-ingress-message';
import { submitOrchestrationIngress } from '../src/domain/usecase/orchestration/submit-orchestration-ingress';
import { subscribeOrchestrationIngressForMachine } from '../src/domain/usecase/orchestration/subscribe-orchestration-ingress';

const attachedSnippetArgsValidator = v.object({
  reference: v.string(),
  fileSource: v.string(),
  selectedContent: v.string(),
});

const ingressContentArgs = {
  chatroomId: v.id('chatroom_rooms'),
  content: v.string(),
  targetRole: v.optional(v.string()),
  attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  attachedBacklogItemIds: v.optional(v.array(v.id('chatroom_backlog'))),
  attachedMessageIds: v.optional(v.array(v.id('chatroom_messages'))),
  attachedSnippets: v.optional(v.array(attachedSnippetArgsValidator)),
  sourcePlatform: v.optional(v.string()),
  scheduledPromptId: v.optional(v.id('chatroom_scheduledPrompts')),
  plannerEnhancerEnabled: v.optional(v.boolean()),
};

const submitUserMessageArgs = {
  ...SessionIdArg,
  ...ingressContentArgs,
};

/** P9: webapp ingress relay — inserts ephemeral row for orchestration-host daemon. */
export const submitUserMessage = mutation({
  args: submitUserMessageArgs,
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const result = await submitOrchestrationIngress(ctx, {
      chatroomId: args.chatroomId,
      userId: session.userId,
      content: args.content,
      targetRole: args.targetRole,
      attachedTaskIds: args.attachedTaskIds,
      attachedBacklogItemIds: args.attachedBacklogItemIds,
      attachedMessageIds: args.attachedMessageIds,
      attachedSnippets: args.attachedSnippets,
      sourcePlatform: args.sourcePlatform,
      scheduledPromptId: args.scheduledPromptId,
      plannerEnhancerEnabled: args.plannerEnhancerEnabled,
    });

    if (!result.ok) {
      throw new ConvexError({
        code: 'ORCHESTRATION_INGRESS_REJECTED',
        reason: result.reason,
      });
    }

    return { ingressId: result.ingressId };
  },
});

/** P9: daemon incremental pull for ingress rows targeting this machine. */
export const subscribeOrchestrationIngressSince = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    afterKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return { items: [], highKey: null, hasMore: false };

    return subscribeOrchestrationIngressForMachine(ctx, {
      machineId: args.machineId,
      userId: auth.userId,
      afterKey: args.afterKey,
      limit: args.limit ?? 50,
    });
  },
});

/** P9: daemon ack after local ingest (idempotent). */
export const ackOrchestrationIngress = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    ingressId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return ackOrchestrationIngressUsecase(ctx, args.ingressId);
  },
});

/** P9 interim: enqueue to Convex queue when daemon detects active tasks (pre-T2 local queue). */
export const enqueueIngressToMessageQueue = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    ingressId: v.string(),
    ...ingressContentArgs,
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const queuedMessageId = await enqueueOrchestrationIngressMessage(ctx, {
      chatroomId: args.chatroomId,
      content: args.content,
      targetRole: args.targetRole,
      attachedTaskIds: args.attachedTaskIds,
      attachedBacklogItemIds: args.attachedBacklogItemIds,
      attachedMessageIds: args.attachedMessageIds,
      attachedSnippets: args.attachedSnippets,
      sourcePlatform: args.sourcePlatform,
      scheduledPromptId: args.scheduledPromptId,
      plannerEnhancerEnabled: args.plannerEnhancerEnabled,
    });
    return { queuedMessageId };
  },
});
