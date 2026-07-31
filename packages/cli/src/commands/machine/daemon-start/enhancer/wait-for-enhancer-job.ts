import { ENHANCER_AGENT_END_GRACE_MS, ENHANCER_JOB_POLL_INTERVAL_MS } from './constants.js';
import { writeEnhancerLog } from './enhancer-log.js';
import { api } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';

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
  /** Called with accumulated assistant text when agent_end fires without complete. Should call complete mutation. */
  onSalvageComplete?: (content: string) => Promise<void>;
}

export async function waitForEnhancerJobResolution(
  params: WaitForEnhancerJobParams
): Promise<EnhancerJobResolution> {
  const { sessionId, chatroomId, jobId, backend, onFailure, onSalvageComplete } = params;

  let outcome: EnhancerJobResolution | null = null;
  let salvagedText = '';

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

  params.onAssistantText?.((text) => {
    salvagedText += text;
  });

  params.onAgentEnd?.(() => {
    if (outcome) return;
    const check = () => {
      if (outcome) return;
      backend
        .query(api.web.enhancer.index.getJob, {
          sessionId,
          chatroomId,
          jobId,
        })
        .then((status: any) => {
          if (outcome) return;
          if (status?.status === 'complete') {
            outcome = 'complete';
            return;
          }
          if (status?.status === 'running') {
            const trimmed = salvagedText.trim();
            if (trimmed && onSalvageComplete) {
              onSalvageComplete(trimmed)
                .then(() => {
                  if (outcome) return;
                  backend
                    .query(api.web.enhancer.index.getJob, {
                      sessionId,
                      chatroomId,
                      jobId,
                    })
                    .then((afterSalvage: any) => {
                      if (afterSalvage?.status === 'complete') {
                        outcome = 'complete';
                        writeEnhancerLog('agent_end: salvaged assistant text via complete');
                        return;
                      }
                      outcome = 'failed';
                      writeEnhancerLog('agent_end: turn ended without complete — failing terminal');
                      void onFailure('Agent exited without completing enhancer job', true);
                    });
                })
                .catch(() => {
                  outcome = 'failed';
                  writeEnhancerLog('agent_end: turn ended without complete — failing terminal');
                  void onFailure('Agent exited without completing enhancer job', true);
                });
            } else {
              outcome = 'failed';
              writeEnhancerLog('agent_end: turn ended without complete — failing terminal');
              void onFailure('Agent exited without completing enhancer job', true);
            }
          }
        });
    };
    setTimeout(check, ENHANCER_AGENT_END_GRACE_MS);
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

  return outcome ?? 'failed';
}
