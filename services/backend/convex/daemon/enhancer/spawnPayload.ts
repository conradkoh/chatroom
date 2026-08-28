import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getDaemonMachineAuth } from './auth';
import {
  ENHANCER_STDIN_DELIMITER,
  HANDOFF_MESSAGE_MARKER,
  formatStdinHeredocCommand,
} from '../../../prompts/cli/stdin-heredoc';
import { getConfig } from '../../../prompts/config/index';
import { renderEnhancerTaskEnvelope } from '../../../prompts/enhancer/render-task-envelope';
import { renderEnhancerSystemPrompt } from '../../../prompts/enhancer/system-prompt';
import { getCliEnvPrefix } from '../../../prompts/utils/index';
import { query } from '../../_generated/server';

const config = getConfig();

/**
 * @deprecated Use `getTaskDeliveryForJob` (task pipeline). Retained for transitional callers.
 */
export const getSpawnPayload = query({
  args: {
    ...SessionIdArg,
    jobId: v.id('chatroom_enhancerJobs'),
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

    const chatroom = await ctx.db.get('chatroom_rooms', job.chatroomId);
    if (!chatroom) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Chatroom not found' });
    }

    const cliEnvPrefix = getCliEnvPrefix(config.getConvexURL());
    const cliHandoffCommand = formatStdinHeredocCommand(
      `chatroom handoff --chatroom-id=${job.chatroomId} --role=enhancer --next-role=${job.fromRole}`,
      ENHANCER_STDIN_DELIMITER,
      '[Design input markdown — follow the output template]',
      { messageMarker: HANDOFF_MESSAGE_MARKER }
    );
    const taskEnvelope = renderEnhancerTaskEnvelope({
      jobId: job._id,
      chatroomId: job.chatroomId,
      originUserMessageId: job.originUserMessageId,
      entryPointRole: job.fromRole,
      outputTemplateContent: job.templateSnapshot,
      requestContent: job.draftContent,
      cliCompleteCommand: cliHandoffCommand,
    });
    const systemPrompt = renderEnhancerSystemPrompt({
      chatroomId: job.chatroomId,
      jobId: job._id,
      cliEnvPrefix,
      originUserMessageId: job.originUserMessageId,
      convexUrl: config.getConvexURLWithFallback(undefined),
    });
    return {
      chatroomId: job.chatroomId,
      jobId: job._id,
      agentHarness: job.agentHarness,
      model: job.model,
      workingDir: job.workingDir,
      systemPrompt,
      taskEnvelope,
    };
  },
});
