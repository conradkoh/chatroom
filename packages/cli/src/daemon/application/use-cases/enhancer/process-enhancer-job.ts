import { api } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { ENHANCER_AGENT_ROLE } from '../../../entry/enhancer/constants.js';
import { writeEnhancerLog } from '../../../entry/enhancer/enhancer-log.js';
import type { RemoteAgentService } from '../../../infrastructure/local/harness/services/remote-agent-service.js';
import { createSpawnPrompt } from '../../../infrastructure/local/harness/services/spawn-prompt.js';
import type { EnhancerQueueJob, EnhancerQueuePort } from '../../ports/enhancer-queue.port.js';

export interface ProcessEnhancerJobDeps {
  sessionId: string;
  machineId: string;
  convexUrl: string;
  backend: BackendOps;
  agentServices: Map<string, RemoteAgentService>;
}

function renderLocalTaskEnvelope(job: EnhancerQueueJob): string {
  const content = job.payload.content?.trim() ?? '(no handoff content)';
  return [
    `You are the enhancer agent for chatroom ${job.chatroomId} (job ${job.jobId}).`,
    'Review the following planner handoff and produce concise planning feedback.',
    '',
    content,
    '',
    'End your turn when the review is complete.',
  ].join('\n');
}

async function resolveWorkingDir(
  deps: ProcessEnhancerJobDeps,
  job: EnhancerQueueJob
): Promise<string | undefined> {
  try {
    const workspaces = (await deps.backend.query(api.workspaces.listWorkspacesForChatroom, {
      sessionId: deps.sessionId,
      chatroomId: job.chatroomId,
    })) as { machineId?: string; workingDir?: string }[] | null;
    const match = (workspaces ?? []).find((w) => w.machineId === deps.machineId);
    return match?.workingDir;
  } catch {
    return undefined;
  }
}

/**
 * Process a claimed local enhancer job: resolve the workspace, spawn the
 * enhancer harness, and record the outcome in the local queue — no Convex
 * pending poll or claim mutations (P4).
 */
// fallow-ignore-next-line complexity
export async function processEnhancerJob(
  deps: ProcessEnhancerJobDeps,
  job: EnhancerQueueJob,
  queue: EnhancerQueuePort
): Promise<void> {
  const service = deps.agentServices.get(job.payload.agentHarness);
  if (!service) {
    writeEnhancerLog(
      `error: harness ${job.payload.agentHarness} not available for job=${job.jobId}`
    );
    queue.markFailed(job.jobId);
    return;
  }

  const workingDir =
    job.payload.workingDir ?? (await resolveWorkingDir(deps, job)) ?? process.cwd();
  writeEnhancerLog(
    `spawning harness=${job.payload.agentHarness} model=${job.payload.model} job=${job.jobId}`
  );

  let spawnResult: Awaited<ReturnType<RemoteAgentService['spawn']>> | null = null;
  try {
    spawnResult = await service.spawn({
      workingDir,
      prompt: createSpawnPrompt(renderLocalTaskEnvelope(job)),
      systemPrompt: `You are the enhancer agent for chatroom ${job.chatroomId}.`,
      model: job.payload.model,
      context: {
        machineId: deps.machineId,
        chatroomId: job.chatroomId,
        role: ENHANCER_AGENT_ROLE,
      },
      resolvedConvexUrl: deps.convexUrl,
    });

    spawnResult.onLogLine?.((line) => writeEnhancerLog(line));

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (outcome: 'complete' | 'failed'): void => {
        if (settled) return;
        settled = true;
        if (outcome === 'complete') {
          queue.markComplete(job.jobId);
          writeEnhancerLog(`completed job=${job.jobId}`);
        } else {
          queue.markFailed(job.jobId);
          writeEnhancerLog(`failed job=${job.jobId}`);
        }
        resolve();
      };
      spawnResult?.onExit(() => settle('failed'));
      spawnResult?.onAgentEnd?.(() => settle('complete'));
    });

    writeEnhancerLog(`done job=${job.jobId}`);
  } catch (err) {
    writeEnhancerLog(`error: ${err instanceof Error ? err.message : String(err)}`);
    queue.markFailed(job.jobId);
  } finally {
    if (spawnResult) {
      try {
        await service.stop(spawnResult.pid);
      } catch {
        // Best-effort stop
      }
    }
  }
}
