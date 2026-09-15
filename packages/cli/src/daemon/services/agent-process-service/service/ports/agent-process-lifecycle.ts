import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent.js';

import type { AgentStartDisposition } from '../../../../domain/entities/agent-slot.js';
import type { StopReason } from '../../../../domain/entities/stop-reason.js';

export interface AgentProcessOperationResult {
  readonly success: boolean;
  readonly pid?: number | undefined;
  readonly disposition?: AgentStartDisposition | undefined;
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

/** Caller-supplied harness/model that wins over the resolved agent config. */
export interface AgentConfigOverrides {
  readonly agentHarness?: string | undefined;
  readonly model?: string | undefined;
}

/** Runtime inputs required to acquire a native delivery session. */
export interface AcquireNativeDeliverySlotInput extends EnsureAgentProcessInput {
  /** Maximum time to wait for a running, idle native session. */
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Harness/model overrides (e.g. ephemeral task-borne parameters). */
  readonly overrides?: AgentConfigOverrides | undefined;
}

export interface StopAgentProcessInput {
  readonly chatroomId: string;
  readonly role: string;
  readonly reason: StopReason;
  readonly pid?: number | undefined;
  readonly workingDir?: string | undefined;
}

export interface HandleAgentProcessExitInput {
  readonly chatroomId: string;
  readonly role: string;
  readonly pid: number;
  readonly code: number | null;
  readonly signal: string | null;
}
