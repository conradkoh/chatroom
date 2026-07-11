import type { TurnEndInput, TurnEndResult, TurnEndSlot } from '../entities/turn-end.js';
import { tryAbortResumeStorm } from '../policies/abort-resume-storm.js';
import type { ResumeStormTracker } from '../ports/resume-storm-tracker.js';
import type { TurnCompletedBackend } from '../ports/turn-completed-backend.js';

export interface HandleTurnCompletedDeps {
  resumeStormTracker: ResumeStormTracker;
  backend: TurnCompletedBackend;
  now: () => number;
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
  if (await tryAbortResumeStorm(deps, input, slot)) {
    return { outcome: 'storm_aborted' };
  }

  deps.killProcess(input.pid);
  return { outcome: 'killed' };
}
