import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import { ENHANCER_STDIN_DELIMITER } from '../../../prompts/cli/stdin-heredoc';
import { renderEnhancerTaskEnvelope } from '../../../prompts/enhancer/render-task-envelope';
import { renderEnhancerSystemPrompt } from '../../../prompts/enhancer/system-prompt';
import { query } from '../../_generated/server';
import { requireSession } from '../../auth/session';

export const getSpawnPayload = query({
  args: {
    ...SessionIdArg,
    jobId: v.id('chatroom_enhancerJobs'),
  },
  handler: async (ctx, args) => {
    await requireSession(ctx, args.sessionId);
    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.status !== 'running') {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer job not running' });
    }
    const cliCompleteCommand = `chatroom enhancer complete --chatroom-id=${job.chatroomId} --job-id=${job._id} << '${ENHANCER_STDIN_DELIMITER}'`;
    const taskEnvelope = renderEnhancerTaskEnvelope({
      jobId: job._id,
      chatroomId: job.chatroomId,
      targetId: 'handoff:planner-to-builder',
      handoffTemplate: job.templateSnapshot,
      draftHandoff: job.draftContent,
      cliCompleteCommand,
    });
    const systemPrompt = renderEnhancerSystemPrompt({
      chatroomId: job.chatroomId,
      jobId: job._id,
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
