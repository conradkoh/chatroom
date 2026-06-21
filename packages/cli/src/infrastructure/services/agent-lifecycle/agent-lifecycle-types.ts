/**
 * AgentLifecycleTypes — extended slot type and public API types.
 *
 * Runtime slot extends the domain's AgentSlotSnapshot with harness metadata
 * that AgentProcessManager tracks but the pure domain layer doesn't.
 */

import type { Effect } from 'effect';
import { Context } from 'effect';

import type { StopReason, AgentSlotSnapshot } from '../../../domain/agent-lifecycle/index.js';
import type { AgentHarness } from '../../machine/types.js';
import type { TryConsumeResult } from '../harness-spawning/index.js';
import type { SpawnPrompt } from '../remote-agents/spawn-prompt.js';

// ─── Runtime Slot ──────────────────────────────────────────────────────────────

/** Extended slot — domain snapshot + harness metadata APM tracks. */
export interface AgentLifecycleSlot extends AgentSlotSnapshot {
  readonly harness?: AgentHarness;
  readonly harnessSessionId?: string;
  readonly model?: string;
  readonly workingDir?: string;
  readonly startedAt?: number;
  readonly wantResume?: boolean;
  readonly recentLogLines?: string[];
  readonly resumeInFlight?: boolean;
  readonly _stopReasonCode?: number;
  readonly _stopReasonSignal?: string | null;
  readonly _initPrompt?: string;
  readonly _systemPrompt?: string;
}

// ─── Public API Types ──────────────────────────────────────────────────────────

export interface OperationResult {
  readonly success: boolean;
  readonly pid?: number;
  readonly error?: 'rate_limited' | 'backoff' | 'crash_loop' | 'spawn_failed' | string;
}

export interface EnsureRunningOpts {
  readonly chatroomId: string;
  readonly role: string;
  readonly agentHarness: AgentHarness;
  readonly model?: string;
  readonly workingDir: string;
  readonly reason: string;
  readonly wantResume: boolean;
  readonly initPrompt?: string;
  readonly systemPrompt?: string;
}

export interface StopOpts {
  readonly chatroomId: string;
  readonly role: string;
  readonly reason: StopReason;
  readonly pid?: number;
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
    model?: string;
    prompt: SpawnPrompt;
    systemPrompt?: string;
  }) => Effect.Effect<
    {
      pid: number;
      harnessSessionId?: string;
      onAgentEnd: (cb: () => void) => void;
      onLogLine?: (cb: (line: string) => void) => void;
    },
    Error
  >;
  stop: (pid: number, opts?: { preserveForResume?: boolean }) => Effect.Effect<void, Error>;
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
