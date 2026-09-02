/**
 * AgentLifecycleTypes — extended slot type and public API types.
 *
 * Runtime slot extends the domain's AgentSlotSnapshot with harness metadata
 * that AgentProcessManager tracks but the pure domain layer doesn't.
 */

import type { Effect } from 'effect';
import { Context } from 'effect';

import type { AgentSlotSnapshot } from '../../../daemon/domain/entities/agent-slot.js';
import type { StopReason } from '../../../daemon/domain/entities/stop-reason.js';
import type { SpawnPrompt } from '../../../daemon/infrastructure/local/harness/services/spawn-prompt.js';
import type { AgentHarness } from '../../machine/types.js';
import type { TryConsumeResult } from '../harness-spawning/index.js';

// ─── Runtime Slot ──────────────────────────────────────────────────────────────

/** Extended slot — domain snapshot + harness metadata APM tracks. */
export interface AgentLifecycleSlot extends AgentSlotSnapshot {
  readonly harness?: AgentHarness | undefined;
  readonly harnessSessionId?: string | undefined;
  readonly resumableHarnessSessionId?: string | undefined;
  readonly model?: string | undefined;
  readonly workingDir?: string | undefined;
  readonly startedAt?: number | undefined;
  readonly wantResume?: boolean | undefined;
  readonly authorizedLifecycleRevision?: number | undefined;
  readonly recentLogLines?: string[] | undefined;
  readonly _stopReasonCode?: number | undefined;
  readonly _stopReasonSignal?: string | null | undefined;
  readonly _initPrompt?: string | undefined;
  readonly _systemPrompt?: string | undefined;
}

// ─── Public API Types ──────────────────────────────────────────────────────────

export interface OperationResult {
  readonly success: boolean;
  readonly pid?: number | undefined;
  readonly error?: 'rate_limited' | 'backoff' | 'crash_loop' | 'spawn_failed' | string | undefined;
  /** When error is `backoff`, milliseconds until the next restart attempt is allowed. */
  readonly retryAfterMs?: number | undefined;
}

export interface EnsureRunningOpts {
  readonly chatroomId: string;
  readonly role: string;
  readonly agentHarness: AgentHarness;
  readonly model?: string | undefined;
  readonly workingDir: string;
  readonly reason: string;
  readonly wantResume: boolean;
  readonly lifecycleRevision?: number | undefined;
  readonly taskId?: string | undefined;
  readonly initPrompt?: string | undefined;
  readonly systemPrompt?: string | undefined;
}

export interface StopOpts {
  readonly chatroomId: string;
  readonly role: string;
  readonly reason: StopReason;
  readonly pid?: number | undefined;
}

export interface HandleExitOpts {
  readonly chatroomId: string;
  readonly role: string;
  readonly pid: number;
  readonly code: number | null;
  readonly signal: string | null;
}

// ─── Ports ─────────────────────────────────────────────────────────────────────

export interface SpawnPort {
  shouldAllowSpawn: (chatroomId: string, reason: string) => TryConsumeResult;
}

export interface HarnessSpawnPort {
  spawn: (args: {
    harness: AgentHarness;
    chatroomId: string;
    role: string;
    workingDir: string;
    model?: string | undefined;
    prompt: SpawnPrompt;
    systemPrompt?: string | undefined;
  }) => Effect.Effect<
    {
      pid: number;
      harnessSessionId?: string | undefined;
      onAgentEnd: (cb: () => void) => void;
      onLogLine?:( (cb: (line: string) => void) => void) | undefined;
    },
    Error
  >;
  stop: (
    pid: number,
    opts?: { preserveForResume?: boolean | undefined },
    harness?: AgentHarness
  ) => Effect.Effect<void, Error>;
  isAlive: (pid: number) => Effect.Effect<boolean>;
}

export interface AgentLifecyclePorts {
  readonly spawn: SpawnPort;
  readonly harness: HarnessSpawnPort;
  readonly sessionId: string;
  readonly machineId: string;
}

export class AgentLifecyclePorts extends Context.Tag('AgentLifecyclePorts')<
  AgentLifecyclePorts,
  AgentLifecyclePorts
>() {}

// ─── Service Shape ─────────────────────────────────────────────────────────────

export interface AgentLifecycleServiceShape {
  ensureRunning: (opts: EnsureRunningOpts) => Effect.Effect<OperationResult>;
  stop: (opts: StopOpts) => Effect.Effect<{ success: boolean }>;
  handleExit: (opts: HandleExitOpts) => Effect.Effect<void>;
  getSlot: (chatroomId: string, role: string) => Effect.Effect<AgentLifecycleSlot | undefined>;
  listActive: () => Effect.Effect<
    readonly {
      chatroomId: string;
      role: string;
      slot: AgentLifecycleSlot;
    }[]
  >;
}

export class AgentLifecycleService extends Context.Tag('AgentLifecycleService')<
  AgentLifecycleService,
  AgentLifecycleServiceShape
>() {}
