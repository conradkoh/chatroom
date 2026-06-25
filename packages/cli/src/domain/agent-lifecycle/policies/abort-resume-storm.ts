import { classifyResumeStormReason } from './classify-resume-storm-reason.js';
import type { TurnEndInput, TurnEndSlot } from '../entities/turn-end.js';
import type { ResumeStormTracker } from '../ports/resume-storm-tracker.js';
import type { TurnCompletedBackend } from '../ports/turn-completed-backend.js';

// fallow-ignore-next-line complexity
export async function tryAbortResumeStorm(
  deps: {
    resumeStormTracker: ResumeStormTracker;
    backend: TurnCompletedBackend;
    now: () => number;
    stopAgent: (args: {
      chatroomId: string;
      role: string;
      reason: 'platform.resume_storm';
    }) => Promise<unknown>;
  },
  input: TurnEndInput,
  slot: TurnEndSlot | undefined
): Promise<boolean> {
  const stormCheck = deps.resumeStormTracker.record(input.chatroomId, input.role, deps.now());

  if (!stormCheck.isStorm) {
    return false;
  }

  deps.resumeStormTracker.reset(input.chatroomId, input.role);

  try {
    await deps.backend.emitResumeStormAborted({
      chatroomId: input.chatroomId,
      role: input.role,
      reason: classifyResumeStormReason(slot?.recentLogLines ?? []),
      endCount: stormCheck.endCount,
      windowMs: stormCheck.windowMs,
      ...(slot?.harnessSessionId ? { harnessSessionId: slot.harnessSessionId } : {}),
    });
  } catch {
    // Best-effort event emission — still stop the agent below.
  }

  if (slot?.state === 'running' && slot.pid === input.pid) {
    await deps.stopAgent({
      chatroomId: input.chatroomId,
      role: input.role,
      reason: 'platform.resume_storm',
    });
  }

  return true;
}
