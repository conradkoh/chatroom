import type { ConvexClient } from 'convex/browser';

import { ENHANCER_AGENT_END_GRACE_MS } from './constants.js';
import type { EnhancerLogWriter } from './enhancer-log.js';
import { writeEnhancerLog } from './enhancer-log.js';
import { subscribeToEnhancerJobOutcome } from './job-outcome-subscription.js';

export type EnhancerJobResolution = 'complete' | 'failed' | 'aborted';

export interface WaitForEnhancerJobParams {
  sessionId: string;
  chatroomId: string;
  jobId: string;
  wsClient: ConvexClient;
  log?: EnhancerLogWriter;
  onAssistantText?: (cb: (text: string) => void) => void;
  onAgentEnd?: (cb: () => void) => void;
  onExit: (cb: () => void) => void;
  onFailure: (error: string, forceTerminal?: boolean) => Promise<void>;
  /** Called with accumulated assistant text when agent_end fires without complete. Should call complete mutation. */
  onSalvageComplete?: (content: string) => Promise<void>;
  signal?: AbortSignal;
}

export async function waitForEnhancerJobResolution(
  params: WaitForEnhancerJobParams
): Promise<EnhancerJobResolution> {
  const { sessionId, chatroomId, jobId, wsClient, onFailure, onSalvageComplete, log, signal } =
    params;
  const writeLog = (message: string) => (log ? log.write(message) : writeEnhancerLog(message));

  let outcome: EnhancerJobResolution | null = null;
  let salvagedText = '';
  let agentEndTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveWait: (() => void) | null = null;
  const waitPromise = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  const subscription = subscribeToEnhancerJobOutcome({
    wsClient,
    sessionId,
    chatroomId,
    jobId,
  });

  const finish = (resolution: EnhancerJobResolution): void => {
    if (outcome) return;
    outcome = resolution;
    resolveWait?.();
    resolveWait = null;
  };

  const onAbort = () => finish('aborted');
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  const failAfterAgentEnd = (): void => {
    writeLog('agent_end: turn ended without complete — failing terminal');
    void onFailure('Agent exited without completing enhancer job', true);
    finish('failed');
  };

  void subscription.outcome
    .then((state) => {
      if (outcome) return;
      const resolution = state.status === 'complete' ? 'complete' : 'failed';
      if (resolution === 'complete') writeLog(`completed job=${jobId}`);
      finish(resolution);
    })
    .catch((error: unknown) => {
      if (outcome) return;
      writeLog(
        `enhancer outcome subscription failed: ${error instanceof Error ? error.message : String(error)}`
      );
      void onFailure('Enhancer job outcome subscription failed', false);
      finish('failed');
    });

  params.onAssistantText?.((text) => {
    salvagedText += text;
  });

  params.onAgentEnd?.(() => {
    if (outcome) return;
    agentEndTimer = setTimeout(() => {
      if (outcome) return;
      const state = subscription.getCurrentState();
      if (state?.status === 'complete') {
        finish('complete');
        return;
      }
      if (state?.status !== 'running') {
        failAfterAgentEnd();
        return;
      }

      const trimmed = salvagedText.trim();
      if (!trimmed || !onSalvageComplete) {
        failAfterAgentEnd();
        return;
      }

      onSalvageComplete(trimmed).catch(() => {
        failAfterAgentEnd();
      });
    }, ENHANCER_AGENT_END_GRACE_MS);
  });

  params.onExit(() => {
    if (outcome) return;
    void onFailure('Agent process exited without completing enhancer job', false);
    finish('failed');
  });

  await waitPromise;

  if (agentEndTimer) clearTimeout(agentEndTimer);
  subscription.stop();
  signal?.removeEventListener('abort', onAbort);

  return outcome ?? 'failed';
}
