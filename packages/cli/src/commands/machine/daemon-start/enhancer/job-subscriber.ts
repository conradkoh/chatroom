import type { ConvexClient } from 'convex/browser';

import { ENHANCER_AGENT_ROLE } from './constants.js';
import { api, type Id } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import type { RemoteAgentService } from '../../../../infrastructure/services/remote-agents/remote-agent-service.js';
import { createSpawnPrompt } from '../../../../infrastructure/services/remote-agents/spawn-prompt.js';

export interface EnhancerJobSubscriberHandles {
  stop: () => void;
}

export function startEnhancerJobSubscriber(
  sessionId: string,
  machineId: string,
  convexUrl: string,
  backend: BackendOps,
  wsClient: ConvexClient,
  agentServices: Map<string, RemoteAgentService>
): EnhancerJobSubscriberHandles {
  const inFlight = new Set<string>();

  const unsub = wsClient.onUpdate(
    api.daemon.enhancer.index.pendingForMachine,
    { sessionId: sessionId as never, machineId },
    (jobs) => {
      for (const job of jobs ?? []) {
        if (inFlight.has(job.jobId)) continue;
        inFlight.add(job.jobId);
        void (async () => {
          let claimed = false;
          let chatroomId = job.chatroomId;
          let jobId = job.jobId;
          try {
            const claim = (await backend.mutation(api.daemon.enhancer.index.claimForSpawn, {
              sessionId,
              jobId: job.jobId,
              machineId,
            })) as { claimed: boolean };
            if (!claim.claimed) return;
            claimed = true;

            const payload = (await backend.query(api.daemon.enhancer.index.getSpawnPayload, {
              sessionId,
              jobId: job.jobId,
            })) as {
              chatroomId: Id<'chatroom_rooms'>;
              jobId: Id<'chatroom_enhancerJobs'>;
              agentHarness: string;
              model: string;
              workingDir: string;
              systemPrompt: string;
              taskEnvelope: string;
            };
            chatroomId = payload.chatroomId;
            jobId = payload.jobId;

            const service = agentServices.get(payload.agentHarness);
            if (!service) {
              await backend.mutation(api.web.enhancer.index.recordAttemptFailure, {
                sessionId,
                chatroomId: payload.chatroomId,
                jobId: payload.jobId,
                error: `Harness ${payload.agentHarness} not available on machine`,
              });
              return;
            }

            const spawnResult = await service.spawn({
              workingDir: payload.workingDir,
              prompt: createSpawnPrompt(payload.taskEnvelope),
              systemPrompt: payload.systemPrompt,
              model: payload.model,
              context: {
                machineId,
                chatroomId: payload.chatroomId,
                role: ENHANCER_AGENT_ROLE,
              },
              resolvedConvexUrl: convexUrl,
            });

            // Stream harness output to daemon logs (same pattern as AgentProcessManager)
            spawnResult.onLogLine?.((line) => {
              process.stdout.write(`${line}\n`);
            });

            await new Promise<void>((resolve) => {
              spawnResult.onExit(() => resolve());
            });

            const status = (await backend.query(api.web.enhancer.index.getJob, {
              sessionId,
              chatroomId: payload.chatroomId,
              jobId: payload.jobId,
            })) as { status: string } | null;

            if (status?.status === 'running') {
              await backend.mutation(api.web.enhancer.index.recordAttemptFailure, {
                sessionId,
                chatroomId: payload.chatroomId,
                jobId: payload.jobId,
                error: 'Agent exited without completing enhancer job',
              });
            }
          } catch (err) {
            console.warn(
              '[enhancer] spawn error:',
              err instanceof Error ? err.message : String(err)
            );
            if (claimed) {
              await backend.mutation(api.web.enhancer.index.recordAttemptFailure, {
                sessionId,
                chatroomId,
                jobId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } finally {
            inFlight.delete(job.jobId);
          }
        })();
      }
    },
    (err) => console.warn('[enhancer] subscription error:', err)
  );

  return { stop: unsub };
}
