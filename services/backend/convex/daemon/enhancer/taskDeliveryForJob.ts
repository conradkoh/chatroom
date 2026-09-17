import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { loadEnhancerJobTask } from './loadJobTask';
import { loadRunningEnhancerJobForMachine } from './loadRunningJob';
import { getConfig } from '../../../prompts/config/index';
import { composeEnhancerSystemPrompt } from '../../../prompts/enhancer/system-prompt';
import { getCliEnvPrefix } from '../../../prompts/utils/index';
import { query } from '../../_generated/server';
import { buildTaskDeliveryPrompt } from '../../lib/taskDeliveryPrompt';

const config = getConfig();

/** Remote enhancer delivery via the standard task pipeline (preferred over getSpawnPayload). */
export const getTaskDeliveryForJob = query({
  args: {
    ...SessionIdArg,
    jobId: v.id('chatroom_enhancerJobs'),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await loadRunningEnhancerJobForMachine(ctx, args);
    const task = await loadEnhancerJobTask(ctx, job);

    const convexUrl = config.getConvexURLWithFallback(args.convexUrl);

    // The delivery prompt is the standard task delivery prompt — the same
    // builder the daemon native injector consumes. Job-specific behaviour is
    // limited to auth, the spawn envelope, and legacy origin fallback.
    const { fullCliOutput: taskDeliveryOutput } = await buildTaskDeliveryPrompt(ctx, {
      chatroomId: job.chatroomId,
      role: job.toRole,
      taskId: task._id,
      convexUrl: args.convexUrl,
      entryPointRole: job.fromRole,
      originUserMessageIdFallback: job.originUserMessageId,
    });

    const systemPrompt = composeEnhancerSystemPrompt({
      chatroomId: job.chatroomId,
      cliEnvPrefix: getCliEnvPrefix(convexUrl),
      entryPointRole: job.fromRole,
      convexUrl,
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
