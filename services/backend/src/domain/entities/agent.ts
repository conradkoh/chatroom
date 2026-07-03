/**
 * Domain Model: Agent
 *
 * Core domain types for agent management. These represent the fundamental
 * concepts in the agent domain — harness types, agent configuration types,
 * command types, and model resolution sources.
 *
 * Each type follows the multi-shape pattern: a single source of truth
 * (as-const tuple) drives the type, enum-like object, Convex validator,
 * and runtime guard. All validators are built via the `toLiteralValidators`
 * helper to preserve precise literal-union types through `v.union(...)`.
 *
 * @see docs/conventions/domain-models.md
 *
 * These are NOT DTOs or intermediate types. They represent the shared
 * vocabulary used across all agent-related use cases.
 */

import { v } from 'convex/values';

import { toLiteralValidators } from './_shared/v-literals-of';

// ─── Agent Harness ───────────────────────────────────────────────────────────

/**
 * Supported agent harness types.
 *
 * A harness is the execution environment that hosts the AI agent.
 */
export const AGENT_HARNESSES = [
  'opencode',
  'opencode-sdk',
  'pi',
  'pi-sdk',
  'cursor',
  'cursor-sdk',
  'claude',
  'claude-sdk',
  'copilot',
  'commandcode',
] as const;

/** The type of agent harness used to run an agent process. */
export type AgentHarness = (typeof AGENT_HARNESSES)[number];

/** Enum-like object: AgentHarnessEnum.opencode === 'opencode', etc. */
export const AgentHarnessEnum = Object.fromEntries(AGENT_HARNESSES.map((h) => [h, h])) as {
  readonly [K in AgentHarness]: K;
};

/** Convex validator for agent harness types. */
export const agentHarnessValidator = v.union(...toLiteralValidators(AGENT_HARNESSES));

/** Runtime type guard. */
export const isAgentHarness = (value: unknown): value is AgentHarness =>
  (AGENT_HARNESSES as readonly string[]).includes(value as string);

/**
 * Detected harness version info from a machine's installed toolchain.
 */
export interface HarnessVersionInfo {
  /** Full version string (e.g. "1.2.3") */
  version: string;
  /** Major version number for compatibility gating */
  major: number;
}

// ─── Agent Type ──────────────────────────────────────────────────────────────

/**
 * How an agent is managed in the system.
 *
 * - `remote`: Machine-managed agent, started/stopped via machine daemon commands
 * - `custom`: User-managed agent, not controlled by the platform
 */
export const AGENT_TYPES = ['remote', 'custom'] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const AgentTypeEnum = Object.fromEntries(AGENT_TYPES.map((t) => [t, t])) as {
  readonly [K in AgentType]: K;
};

export const agentTypeValidator = v.union(...toLiteralValidators(AGENT_TYPES));

export const isAgentType = (value: unknown): value is AgentType =>
  (AGENT_TYPES as readonly string[]).includes(value as string);

// ─── Command Types ───────────────────────────────────────────────────────────

/**
 * Types of commands that can be dispatched to a machine daemon.
 */
export const MACHINE_COMMAND_TYPES = ['start-agent', 'stop-agent', 'ping', 'status'] as const;

export type MachineCommandType = (typeof MACHINE_COMMAND_TYPES)[number];

export const MachineCommandTypeEnum = Object.fromEntries(
  MACHINE_COMMAND_TYPES.map((c) => [c, c])
) as { readonly [K in MachineCommandType]: K };

export const machineCommandTypeValidator = v.union(...toLiteralValidators(MACHINE_COMMAND_TYPES));

export const isMachineCommandType = (value: unknown): value is MachineCommandType =>
  (MACHINE_COMMAND_TYPES as readonly string[]).includes(value as string);

/**
 * Status of a machine command in its lifecycle.
 */
export const MACHINE_COMMAND_STATUSES = ['pending', 'completed', 'failed'] as const;

export type MachineCommandStatus = (typeof MACHINE_COMMAND_STATUSES)[number];

export const MachineCommandStatusEnum = Object.fromEntries(
  MACHINE_COMMAND_STATUSES.map((s) => [s, s])
) as { readonly [K in MachineCommandStatus]: K };

export const machineCommandStatusValidator = v.union(
  ...toLiteralValidators(MACHINE_COMMAND_STATUSES)
);

export const isMachineCommandStatus = (value: unknown): value is MachineCommandStatus =>
  (MACHINE_COMMAND_STATUSES as readonly string[]).includes(value as string);

// ─── Agent Reason Types ───────────────────────────────────────────────────────
//
// Single source of truth for all agent start/stop reasons.
// Uses actor-prefixed dot notation: <actor>.<action>
//
// Actors:
//   user      — human-initiated via UI or CLI
//   platform  — server-side automation (dedup, team switch, crash recovery)
//   daemon    — machine daemon lifecycle (respawn)

/**
 * Why an agent was started. Used in `agent.requestStart` events.
 *
 * - `user.start`: User explicitly started the agent via UI or CLI
 * - `user.restart`: @deprecated — no longer used, kept for backward compatibility with old events
 * - `platform.crash_recovery`: Daemon restart after agent exit (all harnesses)
 * - `platform.auto_restart_on_new_context`: @deprecated — historical events only; no longer emitted
 * - `platform.restart_offline_on_user_message`: Restart offline remote agents when user sends a message (using persisted team config)
 * - `test`: Used in integration and unit tests only
 */
export const AGENT_START_REASONS = [
  'user.start',
  /** @deprecated No longer used — kept for backward compatibility with old events */
  'user.restart',
  'platform.crash_recovery',
  'platform.auto_restart_on_new_context',
  'platform.restart_offline_on_user_message',
  'test',
] as const;

export type AgentStartReason = (typeof AGENT_START_REASONS)[number];

export const AgentStartReasonEnum = Object.fromEntries(AGENT_START_REASONS.map((r) => [r, r])) as {
  readonly [K in AgentStartReason]: K;
};

export const agentStartReasonValidator = v.union(...toLiteralValidators(AGENT_START_REASONS));

export const isAgentStartReason = (value: unknown): value is AgentStartReason =>
  (AGENT_START_REASONS as readonly string[]).includes(value as string);

/**
 * Why an agent was stopped. Used in `agent.requestStop` events and
 * `agent.exited` stopReason field. Same type flows from request through
 * to exit — the daemon passes through the reason it received.
 *
 * - `user.stop`: User explicitly stopped the agent via UI or CLI
 * - `platform.dedup`: Agent stopped to deduplicate roles (another agent took over)
 * - `platform.team_switch`: Agent stopped because the chatroom's team was changed (no auto-restart)
 * - `daemon.respawn`: Daemon killed agent to spawn a fresh instance
 * - `daemon.shutdown`: Daemon process shutting down (SIGINT/SIGTERM/SIGHUP) — all agents stopped
 * - `test`: Used in integration and unit tests only
 */
export const AGENT_STOP_REASONS = [
  'user.stop',
  'platform.dedup',
  'platform.team_switch',
  'platform.resume_storm',
  'daemon.respawn',
  'daemon.shutdown',
  'test',
] as const;

export type AgentStopReason = (typeof AGENT_STOP_REASONS)[number];

export const AgentStopReasonEnum = Object.fromEntries(AGENT_STOP_REASONS.map((r) => [r, r])) as {
  readonly [K in AgentStopReason]: K;
};

export const agentStopReasonValidator = v.union(...toLiteralValidators(AGENT_STOP_REASONS));

export const isAgentStopReason = (value: unknown): value is AgentStopReason =>
  (AGENT_STOP_REASONS as readonly string[]).includes(value as string);

// ─── Model Source ────────────────────────────────────────────────────────────

/**
 * Where the agent's AI model was resolved from.
 *
 * - `team_config`: From the team-level agent configuration
 * - `none`: No model configured
 */
export const MODEL_SOURCES = ['team_config', 'none'] as const;

export type ModelSource = (typeof MODEL_SOURCES)[number];

export const ModelSourceEnum = Object.fromEntries(MODEL_SOURCES.map((s) => [s, s])) as {
  readonly [K in ModelSource]: K;
};

export const modelSourceValidator = v.union(...toLiteralValidators(MODEL_SOURCES));

export const isModelSource = (value: unknown): value is ModelSource =>
  (MODEL_SOURCES as readonly string[]).includes(value as string);
