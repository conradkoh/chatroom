import type { ResumeStormReason } from '@workspace/backend/src/domain/entities/resume-storm.js';

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
