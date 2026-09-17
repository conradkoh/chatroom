import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { loadRunningEnhancerJobForMachine } from './loadRunningJob';
import {
  ENHANCER_STDIN_DELIMITER,
  HANDOFF_MESSAGE_MARKER,
  formatStdinHeredocCommand,
} from '../../../prompts/cli/stdin-heredoc';
import { getConfig } from '../../../prompts/config/index';
import { getEnhancerHistoryRetrievalGuidance } from '../../../prompts/enhancer/history-retrieval';
import { renderEnhancerTaskEnvelope } from '../../../prompts/enhancer/render-task-envelope';
import { composeEnhancerSystemPrompt } from '../../../prompts/enhancer/system-prompt';
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
  handler: async (ctx, args) => {
    const job = await loadRunningEnhancerJobForMachine(ctx, args);
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
    const systemPrompt = [
      composeEnhancerSystemPrompt({
        chatroomId: job.chatroomId,
        cliEnvPrefix,
        convexUrl: config.getConvexURLWithFallback(undefined),
      }),
      // Legacy envelope delivery never renders the standard task prompt, so the
      // origin-anchored history retrieval stays in this prompt until the
      // deprecated spawn payload is removed.
      getEnhancerHistoryRetrievalGuidance({
        chatroomId: job.chatroomId,
        cliEnvPrefix,
        originUserMessageId: job.originUserMessageId,
      }),
    ].join('\n\n');
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
