import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { api } from '../../../../api.js';
import { writeEnhancerLog } from './enhancer-log.js';
import {
  ENHANCER_AGENT_END_GRACE_MS,
  ENHANCER_JOB_POLL_INTERVAL_MS,
  ENHANCER_SILENCE_TIMEOUT_MS,
} from './constants.js';

export type EnhancerJobResolution = 'complete' | 'failed';

export interface WaitForEnhancerJobParams {
  sessionId: string;
  chatroomId: string;
  jobId: string;
  backend: BackendOps;
  onAssistantText?: (cb: (text: string) => void) => void;
  onAgentEnd?: (cb: () => void) => void;
  onExit: (cb: () => void) => void;
  onFailure: (error: string, forceTerminal?: boolean) => Promise<void>;
}

export async function waitForEnhancerJobResolution(
  params: WaitForEnhancerJobParams
): Promise<EnhancerJobResolution> {
  const { sessionId, chatroomId, jobId, backend, onFailure } = params;

  let outcome: EnhancerJobResolution | null = null;
  let lastActivityAt = Date.now();

  const pollInterval = setInterval(async () => {
    if (outcome) return;
    try {
      const status = (await backend.query(api.web.enhancer.index.getJob, {
        sessionId,
        chatroomId,
        jobId,
      })) as { status: string } | null;

      if (status?.status === 'complete') {
        outcome = 'complete';
        writeEnhancerLog(`completed job=${jobId}`);
      }
    } catch {
      // Transient errors are swallowed — poll continues
    }
  }, ENHANCER_JOB_POLL_INTERVAL_MS);

  const silenceInterval = setInterval(() => {
    if (outcome) return;
    if (Date.now() - lastActivityAt >= ENHANCER_SILENCE_TIMEOUT_MS) {
      outcome = 'failed';
      writeEnhancerLog(`silence timeout — no activity for ${ENHANCER_SILENCE_TIMEOUT_MS}ms`);
      void onFailure('Enhancer silence timeout — no output received', false);
    }
  }, ENHANCER_JOB_POLL_INTERVAL_MS);

  params.onAssistantText?.(() => {
    lastActivityAt = Date.now();
  });

  params.onAgentEnd?.(() => {
    if (outcome) return;
    setTimeout(async () => {
      if (outcome) return;
      const status = (await backend.query(api.web.enhancer.index.getJob, {
        sessionId,
        chatroomId,
        jobId,
      })) as { status: string } | null;

      if (status?.status === 'complete') {
        outcome = 'complete';
        return;
      }
      if (status?.status === 'running') {
        outcome = 'failed';
        writeEnhancerLog('agent_end: turn ended without complete — failing terminal');
        void onFailure('Agent exited without completing enhancer job', true);
      }
    }, ENHANCER_AGENT_END_GRACE_MS);
  });

  params.onExit(() => {
    if (outcome) return;
    outcome = 'failed';
    void onFailure('Agent process exited without completing enhancer job', false);
  });

  // Wait for outcome
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (outcome) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  clearInterval(pollInterval);
  clearInterval(silenceInterval);

  return outcome ?? 'failed';
}
