import type { ConvexClient } from 'convex/browser';

import { ENHANCER_AGENT_ROLE } from './constants.js';
import { writeEnhancerLog } from './enhancer-log.js';
import { waitForEnhancerJobResolution } from './wait-for-enhancer-job.js';
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
          let spawnResult: Awaited<ReturnType<RemoteAgentService['spawn']>> | null = null;
          let service: RemoteAgentService | null = null;
          try {
            const claim = (await backend.mutation(api.daemon.enhancer.index.claimForSpawn, {
              sessionId,
              jobId: job.jobId,
              machineId,
            })) as { claimed: boolean };
            if (!claim.claimed) return;
            claimed = true;
            writeEnhancerLog(`claimed job=${job.jobId} chatroom=${job.chatroomId}`);

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

            writeEnhancerLog(
              `spawning harness=${payload.agentHarness} model=${payload.model} job=${payload.jobId}`
            );

            service = agentServices.get(payload.agentHarness) ?? null;
            if (!service) {
              await backend.mutation(api.web.enhancer.index.recordAttemptFailure, {
                sessionId,
                chatroomId: payload.chatroomId,
                jobId: payload.jobId,
                error: `Harness ${payload.agentHarness} not available on machine`,
              });
              return;
            }

            spawnResult = await service.spawn({
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

            spawnResult.onLogLine?.((line) => {
              writeEnhancerLog(line);
            });

            const sr = spawnResult!;
            const outcome = await waitForEnhancerJobResolution({
              sessionId,
              chatroomId: payload.chatroomId,
              jobId: payload.jobId,
              backend,
              onAssistantText: sr.onAssistantText ? (cb) => sr.onAssistantText!(cb) : undefined,
              onAgentEnd: sr.onAgentEnd ? (cb) => sr.onAgentEnd!(cb) : undefined,
              onExit: (cb) => sr.onExit(() => cb()),
              onFailure: async (error, forceTerminal) => {
                await backend.mutation(api.web.enhancer.index.recordAttemptFailure, {
                  sessionId,
                  chatroomId: payload.chatroomId,
                  jobId: payload.jobId,
                  error,
                  ...(forceTerminal ? { forceTerminal: true } : {}),
                });
              },
            });

            writeEnhancerLog(`completed job=${jobId}`);
          } catch (err) {
            writeEnhancerLog(`error: ${err instanceof Error ? err.message : String(err)}`);
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
            if (spawnResult && service) {
              try {
                await service.stop(spawnResult.pid);
              } catch {
                // Best-effort stop
              }
            }
          }
        })();
      }
    },
    (err) => console.warn('[enhancer] subscription error:', err)
  );

  return { stop: unsub };
}
