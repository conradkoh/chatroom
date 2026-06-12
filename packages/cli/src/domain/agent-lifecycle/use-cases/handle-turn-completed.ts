import type { TurnEndInput, TurnEndResult, TurnEndSlot } from '../entities/turn-end.js';
import { tryAbortResumeStorm } from '../policies/abort-resume-storm.js';
import type { ResumeStormTracker } from '../ports/resume-storm-tracker.js';
import type { TurnCompletedBackend } from '../ports/turn-completed-backend.js';

export interface HandleTurnCompletedDeps {
  resumeStormTracker: ResumeStormTracker;
  backend: TurnCompletedBackend;
  now: () => number;
  composeResumePrompt: (args: { chatroomId: string; role: string }) => string;
  resumeTurn: (pid: number, prompt: string) => Promise<void>;
  killProcess: (pid: number) => void;
  stopAgent: (args: {
    chatroomId: string;
    role: string;
    reason: 'platform.resume_storm';
  }) => Promise<unknown>;
}

// fallow-ignore-next-line complexity
export async function handleTurnCompleted(
  deps: HandleTurnCompletedDeps,
  input: TurnEndInput,
  slot: TurnEndSlot | undefined
): Promise<TurnEndResult> {
  if (slot?.resumeInFlight) {
    return { outcome: 'skipped_duplicate' };
  }

  if (await tryAbortResumeStorm(deps, input, slot)) {
    return { outcome: 'storm_aborted' };
  }

  if (input.supportsSessionResume && input.wantResume) {
    if (slot) {
      slot.resumeInFlight = true;
    }
    try {
      await deps.resumeTurn(
        input.pid,
        deps.composeResumePrompt({ chatroomId: input.chatroomId, role: input.role })
      );

      try {
        await deps.backend.emitSessionResumed({
          chatroomId: input.chatroomId,
          role: input.role,
          ...(slot?.harnessSessionId ? { harnessSessionId: slot.harnessSessionId } : {}),
        });
      } catch {
        // Best-effort event emission
      }

      return { outcome: 'resumed' };
    } catch (err) {
      if (slot) {
        slot.turnResumeFailed = true;
      }
      try {
        await deps.backend.emitSessionResumeFailed({
          chatroomId: input.chatroomId,
          role: input.role,
          reason: (err as Error).message,
          ...(slot?.harnessSessionId ? { harnessSessionId: slot.harnessSessionId } : {}),
        });
      } catch {
        // Best-effort event emission
      }
    } finally {
      if (slot) {
        slot.resumeInFlight = false;
      }
    }
  }

  deps.killProcess(input.pid);
  return { outcome: 'killed' };
}
