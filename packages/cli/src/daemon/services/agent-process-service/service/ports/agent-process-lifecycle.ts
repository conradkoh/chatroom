import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent.js';

import type { StopReason } from '../../../../domain/entities/stop-reason.js';

export interface AgentProcessOperationResult {
  readonly success: boolean;
  readonly pid?: number | undefined;
  readonly error?: string | undefined;
  readonly retryAfterMs?: number | undefined;
}

export interface EnsureAgentProcessInput {
  readonly chatroomId: string;
  readonly role: string;
  readonly agentHarness: AgentHarness;
  readonly model?: string | undefined;
  readonly workingDir: string;
  readonly reason: string;
  readonly wantResume: boolean;
  readonly taskId?: string | undefined;
  readonly initPrompt?: string | undefined;
  readonly systemPrompt?: string | undefined;
}

export interface StopAgentProcessInput {
  readonly chatroomId: string;
  readonly role: string;
  readonly reason: StopReason;
  readonly pid?: number | undefined;
}

export interface HandleAgentProcessExitInput {
  readonly chatroomId: string;
  readonly role: string;
  readonly pid: number;
  readonly code: number | null;
  readonly signal: string | null;
}
