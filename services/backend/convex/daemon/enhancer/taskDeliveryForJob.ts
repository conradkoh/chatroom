import {
  legacyConversationMode,
  plannerEnhancerEnabledForMode,
} from '@workspace/shared/domain/conversation-mode';
import { normalizeTaskEnvelope } from '@workspace/shared/domain/task-envelope';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getDaemonMachineAuth } from './auth';
import { generateFullCliOutput } from '../../../prompts/cli/get-next-task/fullOutput';
import { getConfig } from '../../../prompts/config/index';
import { renderEnhancerSystemPrompt } from '../../../prompts/enhancer/system-prompt';
import { getCliEnvPrefix } from '../../../prompts/utils/index';
import { isNativeHarness } from '../../../src/domain/entities/harness/types';
import { isActiveParticipant } from '../../../src/domain/entities/participant';
import { getActiveStandingInstructions } from '../../../src/domain/entities/standing-instructions';
import { getTeamEntryPoint } from '../../../src/domain/entities/team';
import { getEnhancerConfigForUser } from '../../../src/domain/usecase/enhancer/get-enhancer-config-for-user';
import { resolveTaskPlannerEnhancerEnabled } from '../../../src/domain/usecase/enhancer/resolve-planner-enhancer-enabled';
import type { Doc } from '../../_generated/dataModel';
import { query } from '../../_generated/server';
import { buildAvailableHandoffRoles } from '../../lib/handoffRoles';
import { resolveSourceAttachmentsForDelivery } from '../../messages';
import { buildTeamRoleKey } from '../../utils/teamRoleKey';

const config = getConfig();

/** Remote enhancer delivery via the standard task pipeline (preferred over getSpawnPayload). */
export const getTaskDeliveryForJob = query({
  args: {
    ...SessionIdArg,
    jobId: v.id('chatroom_enhancerJobs'),
    convexUrl: v.optional(v.string()),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.status !== 'running') {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer job not running' });
    }

    const auth = await getDaemonMachineAuth(ctx, args.sessionId, job.machineId);
    if (!auth) {
      throw new ConvexError({
        code: 'NOT_AUTHORIZED_MACHINE',
        message: 'Not authorized for this machine',
      });
    }

    if (!job.taskId) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Enhancer job missing linked task',
      });
    }

    const task = await ctx.db.get('chatroom_tasks', job.taskId);
    if (!task || task.chatroomId !== job.chatroomId) {
      throw new ConvexError({ code: 'TASK_NOT_FOUND', message: 'Linked enhancer task not found' });
    }

    const chatroom = await ctx.db.get('chatroom_rooms', job.chatroomId);
    if (!chatroom) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Chatroom not found' });
    }

    let message: Doc<'chatroom_messages'> | Doc<'chatroom_messageQueue'> | null = null;
    if (task.sourceMessageId) {
      const regularMessage = await ctx.db
        .get('chatroom_messages', task.sourceMessageId)
        .catch(() => null);
      if (regularMessage) {
        message = regularMessage;
      }
    }

    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', job.chatroomId))
      .collect();

    const role = job.toRole;
    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== role.toLowerCase() && isActiveParticipant(p)
    );
    const availableRoles = waitingParticipants.map((p) => p.role);

    const enhancerConfig = await getEnhancerConfigForUser(ctx, job.chatroomId, auth.userId);
    const legacyPlannerEnhancerEnabled = resolveTaskPlannerEnhancerEnabled({
      taskPlannerEnhancerEnabled: task.plannerEnhancerEnabled,
      liveConfig: enhancerConfig,
      role,
      team: chatroom,
    });

    // The explicit task envelope is authoritative for mode/enhancer policy at
    // this delivery boundary. Legacy rows without an envelope retain the
    // existing live-config behaviour.
    const hasExplicitTaskEnvelope = task.taskEnvelope !== undefined;
    const normalizedTaskEnvelope = normalizeTaskEnvelope(task);
    const conversationMode = hasExplicitTaskEnvelope
      ? normalizedTaskEnvelope.conversationMode
      : legacyConversationMode(legacyPlannerEnhancerEnabled);
    const plannerEnhancerEnabled = hasExplicitTaskEnvelope
      ? plannerEnhancerEnabledForMode(normalizedTaskEnvelope.conversationMode)
      : legacyPlannerEnhancerEnabled;

    const deliveryMessageSenderRole =
      message && 'senderRole' in message ? message.senderRole.toLowerCase() : undefined;

    const availableHandoffRoles = buildAvailableHandoffRoles(availableRoles, {
      includeEnhancer: plannerEnhancerEnabled && deliveryMessageSenderRole === 'user',
    });

    const sourceAttachments = await resolveSourceAttachmentsForDelivery(ctx, message);
    const cliEnvPrefix = getCliEnvPrefix(config.getConvexURLWithFallback(args.convexUrl));
    const entryPoint = getTeamEntryPoint(chatroom);
    const isEntryPoint = entryPoint ? role.toLowerCase() === entryPoint.toLowerCase() : false;

    const teamRoleKey = chatroom.teamId
      ? buildTeamRoleKey(chatroom._id, chatroom.teamId, role)
      : null;
    const existingAgentConfig = teamRoleKey
      ? await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
          .first()
      : null;
    const nativeIntegration = isNativeHarness(existingAgentConfig?.agentHarness);

    const taskDeliveryOutput = generateFullCliOutput({
      chatroomId: job.chatroomId,
      role,
      cliEnvPrefix,
      teamId: chatroom.teamId ?? 'duo',
      task: {
        _id: task._id,
        content: task.content,
      },
      message: message
        ? {
            _id: message._id,
            senderRole: message.senderRole,
            content: message.content,
          }
        : null,
      isEntryPoint,
      availableHandoffTargets: availableHandoffRoles,
      nativeIntegration,
      sourceAttachments,
      standingInstructions: getActiveStandingInstructions(chatroom),
      plannerEnhancerEnabled,
      conversationMode,
      entryPointRole: job.fromRole,
      originUserMessageId: task.originUserMessageId ?? job.originUserMessageId ?? undefined,
    });

    const systemPrompt = renderEnhancerSystemPrompt({
      chatroomId: job.chatroomId,
      jobId: job._id,
      cliEnvPrefix,
      originUserMessageId: task.originUserMessageId ?? job.originUserMessageId,
      entryPointRole: job.fromRole,
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
    });

    return {
      chatroomId: job.chatroomId,
      jobId: job._id,
      taskId: job.taskId,
      agentHarness: job.agentHarness,
      model: job.model,
      workingDir: job.workingDir,
      systemPrompt,
      taskDeliveryOutput,
    };
  },
});
