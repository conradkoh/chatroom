import { tryAbortResumeStorm } from './abort-resume-storm.js';
import type { TurnEndInput, TurnEndResult, TurnEndSlot } from '../entities/native-turn.js';
import type { ResumeStormReason } from '../entities/resume-storm.js';

export interface ResumeStormCheck {
  isStorm: boolean;
  endCount: number;
  windowMs: number;
  threshold: number;
}

export interface ResumeStormTracker {
  record(chatroomId: string, role: string, now: number): ResumeStormCheck;
  reset(chatroomId: string, role: string): void;
}

export interface TurnCompletedBackend {
  emitResumeStormAborted(args: {
    chatroomId: string;
    role: string;
    reason: ResumeStormReason;
    endCount: number;
    windowMs: number;
    harnessSessionId?: string;
  }): Promise<void>;
  emitAgentStartFailed(args: { chatroomId: string; role: string; error: string }): Promise<void>;
}

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
