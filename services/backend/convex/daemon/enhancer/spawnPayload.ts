import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getDaemonMachineAuth } from './auth';
import { ENHANCER_STDIN_DELIMITER } from '../../../prompts/cli/stdin-heredoc';
import { getConfig } from '../../../prompts/config/index';
import {
  renderEnhancerOutputTemplateContent,
  renderEnhancerReferencesXml,
} from '../../../prompts/enhancer/reference-handoff-templates';
import { renderEnhancerTaskEnvelope } from '../../../prompts/enhancer/render-task-envelope';
import { renderEnhancerSystemPrompt } from '../../../prompts/enhancer/system-prompt';
import { getCliEnvPrefix } from '../../../prompts/utils/index';
import { query } from '../../_generated/server';

const config = getConfig();

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
    const outputTemplateContent = renderEnhancerOutputTemplateContent({
      teamId: chatroom.teamId ?? 'duo',
      chatroomId: job.chatroomId,
      outputTemplate: job.templateSnapshot,
      cliEnvPrefix,
      nativeIntegration: true,
    });
    const referencesXml = renderEnhancerReferencesXml({
      teamId: chatroom.teamId ?? 'duo',
      chatroomId: job.chatroomId,
      outputTemplate: job.templateSnapshot,
      cliEnvPrefix,
      nativeIntegration: true,
    });

    const cliCompleteCommand = `chatroom enhancer complete --chatroom-id=${job.chatroomId} --job-id=${job._id} << '${ENHANCER_STDIN_DELIMITER}'`;
    const taskEnvelope = renderEnhancerTaskEnvelope({
      jobId: job._id,
      chatroomId: job.chatroomId,
      targetId: 'handoff:planner-to-builder',
      outputTemplateContent,
      referencesXml,
      plannerCheckIn: job.draftContent,
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
