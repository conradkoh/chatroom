import type { ConvexClient } from 'convex/browser';

import { ENHANCER_AGENT_ROLE } from './constants.js';
import { createEnhancerLogWriter, type EnhancerLogWriter } from './enhancer-log.js';
import { waitForEnhancerJobResolution } from './wait-for-enhancer-job.js';
import { isChatroomStopScopeActive } from '../../infrastructure/agent-process-manager/execute-stop-targets-adapter.js';
import { registerEnhancerSpawn, unregisterEnhancerSpawn, type EnhancerSpawnHandle } from './enhancer-spawn-registry.js';
import { clearEnhancerDrainHandlerForTests, setEnhancerDrainHandler } from './enhancer-drain-registry.js';
import { api, type Id } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { AgentLogSink } from '../../../infrastructure/log-server/index.js';
import type { RemoteAgentService } from '../../infrastructure/local/harness/services/remote-agent-service.js';
import { createSpawnPrompt } from '../../infrastructure/local/harness/services/spawn-prompt.js';
import {
  registerEnhancerInboundHandler,
  unregisterEnhancerInboundHandler,
} from '../enhancer-inbound-registry.js';

type PendingEnhancerJob = {
  jobId: string;
  chatroomId: string;
};

export interface EnhancerJobSubscriberHandles {
  stop: () => void;
  drainPendingEnhancerJobs: () => Promise<void>;
}

async function processEnhancerJobForSpawn(
  sessionId: string,
  machineId: string,
  convexUrl: string,
  wsClient: ConvexClient,
  backend: BackendOps,
  agentServices: Map<string, RemoteAgentService>,
  job: PendingEnhancerJob,
  inFlight: Set<string>,
  logSink?: AgentLogSink
): Promise<void> {
  if (inFlight.has(job.jobId)) return;
  if (isChatroomStopScopeActive(job.chatroomId)) return;
  inFlight.add(job.jobId);

  let claimed = false;
  let chatroomId = job.chatroomId;
  let jobId = job.jobId;
  let spawnResult: Awaited<ReturnType<RemoteAgentService['spawn']>> | null = null;
  let service: RemoteAgentService | null = null;
  let abortController: AbortController | null = null;
  let spawnHandle: EnhancerSpawnHandle | null = null;
  let log: EnhancerLogWriter = createEnhancerLogWriter(logSink, {
    chatroomId: job.chatroomId,
    harness: 'unknown',
  });

  try {
    const claim = (await backend.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId: job.jobId,
      machineId,
    })) as { claimed: boolean };
    if (!claim.claimed) return;
    claimed = true;
    log.write(`claimed job=${job.jobId} chatroom=${job.chatroomId}`);

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
    log = createEnhancerLogWriter(logSink, {
      chatroomId: payload.chatroomId,
      harness: payload.agentHarness,
      pid: undefined,
    });

    log.write(
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

    const spawned = await service.spawn({
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
    spawnResult = spawned;
    abortController = new AbortController();
    spawnHandle = {
      jobId: payload.jobId,
      chatroomId: payload.chatroomId,
      abort: () => abortController?.abort(),
      stopProcess: async () => {
        await service?.stop(spawned.pid);
      },
    };
    registerEnhancerSpawn(spawnHandle);
    log = createEnhancerLogWriter(logSink, {
      chatroomId: payload.chatroomId,
      harness: payload.agentHarness,
      pid: spawned.pid,
    });

    spawned.onLogLine?.((line) => {
      log.write(line);
    });

    await waitForEnhancerJobResolution({
      sessionId,
      chatroomId: payload.chatroomId,
      jobId: payload.jobId,
      wsClient,
      log,
      onAssistantText: spawned.onAssistantText ? (cb) => spawned.onAssistantText?.(cb) : undefined,
      onAgentEnd: spawned.onAgentEnd ? (cb) => spawned.onAgentEnd?.(cb) : undefined,
      onExit: (cb) => spawned.onExit(() => cb()),
      onSalvageComplete: async (content) => {
        await backend.mutation(api.web.enhancer.index.complete, {
          sessionId,
          chatroomId: payload.chatroomId,
          jobId: payload.jobId,
          enhancedContent: content,
        });
      },
      onFailure: async (error, forceTerminal) => {
        await backend.mutation(api.web.enhancer.index.recordAttemptFailure, {
          sessionId,
          chatroomId: payload.chatroomId,
          jobId: payload.jobId,
          error,
          ...(forceTerminal ? { forceTerminal: true } : {}),
        });
      },
      signal: abortController.signal,
    });

    if (!abortController.signal.aborted) log.write(`completed job=${jobId}`);
  } catch (err) {
    log.write(`error: ${err instanceof Error ? err.message : String(err)}`);
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
    if (spawnHandle) unregisterEnhancerSpawn(spawnHandle);
    if (spawnResult && service) {
      try {
        await service.stop(spawnResult.pid);
      } catch {
        // Best-effort stop
      }
    }
  }
}

function processEnhancerJobs(
  sessionId: string,
  machineId: string,
  convexUrl: string,
  wsClient: ConvexClient,
  backend: BackendOps,
  agentServices: Map<string, RemoteAgentService>,
  jobs: PendingEnhancerJob[] | null | undefined,
  inFlight: Set<string>,
  logSink?: AgentLogSink
): void {
  for (const job of jobs ?? []) {
    void processEnhancerJobForSpawn(
      sessionId,
      machineId,
      convexUrl,
      wsClient,
      backend,
      agentServices,
      job,
      inFlight,
      logSink
    );
  }
}

async function drainPendingEnhancerJobs(
  sessionId: string,
  machineId: string,
  convexUrl: string,
  wsClient: ConvexClient,
  backend: BackendOps,
  agentServices: Map<string, RemoteAgentService>,
  inFlight: Set<string>,
  logSink?: AgentLogSink
): Promise<void> {
  const jobs = (await backend.query(api.daemon.enhancer.index.pendingForMachine, {
    sessionId: sessionId as never,
    machineId,
  })) as PendingEnhancerJob[] | null;

  if (!jobs?.length) return;
  processEnhancerJobs(
    sessionId,
    machineId,
    convexUrl,
    wsClient,
    backend,
    agentServices,
    jobs,
    inFlight,
    logSink
  );
}

export function startEnhancerJobSubscriber(
  sessionId: string,
  machineId: string,
  convexUrl: string,
  wsClient: ConvexClient,
  backend: BackendOps,
  agentServices: Map<string, RemoteAgentService>,
  logSink?: AgentLogSink
): EnhancerJobSubscriberHandles {
  const inFlight = new Set<string>();

  registerEnhancerInboundHandler(async () => {
    await drainPendingEnhancerJobs(
      sessionId,
      machineId,
      convexUrl,
      wsClient,
      backend,
      agentServices,
      inFlight,
      logSink
    );
  });
  setEnhancerDrainHandler(() =>
    drainPendingEnhancerJobs(
      sessionId,
      machineId,
      convexUrl,
      wsClient,
      backend,
      agentServices,
      inFlight,
      logSink
    )
  );

  return {
    stop: () => {
      unregisterEnhancerInboundHandler();
      clearEnhancerDrainHandlerForTests();
    },
    drainPendingEnhancerJobs: () =>
      drainPendingEnhancerJobs(
        sessionId,
        machineId,
        convexUrl,
        wsClient,
        backend,
        agentServices,
        inFlight,
        logSink
      ),
  };
}
