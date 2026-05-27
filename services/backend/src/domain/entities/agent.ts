/**
 * Domain Model: Agent
 *
 * Core domain types for agent management. These represent the fundamental
 * concepts in the agent domain — harness types, agent configuration types,
 * command types, and model resolution sources.
 *
 * Harness types follow the multi-shape pattern: a single source of truth
 * (as-const tuple) drives the type, enum-like object, Convex validator,
 * Zod schema, and runtime guard.
 *
 * @see docs/conventions/domain-models.md
 *
 * These are NOT DTOs or intermediate types. They represent the shared
 * vocabulary used across all agent-related use cases.
 */

import { v } from 'convex/values';
import { z } from 'zod';

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
  'cursor',
  'claude',
  'copilot',
  'commandcode',
] as const;

/** The type of agent harness used to run an agent process. */
export type AgentHarness = (typeof AGENT_HARNESSES)[number];

/** Enum-like object: AgentHarnessEnum.opencode === 'opencode', etc. */
export const AgentHarnessEnum = Object.fromEntries(
  AGENT_HARNESSES.map((h) => [h, h])
) as { readonly [K in AgentHarness]: K };

/** Convex validator for agent harness types. */
export const agentHarnessValidator = v.union(...toLiteralValidators(AGENT_HARNESSES));

/** Zod schema for API / CLI validation of harness values. */
export const agentHarnessZodSchema = z.enum(AGENT_HARNESSES);

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
export type AgentType = 'remote' | 'custom';

// ─── Command Types ───────────────────────────────────────────────────────────

/**
 * Types of commands that can be dispatched to a machine daemon.
 */
export type MachineCommandType = 'start-agent' | 'stop-agent' | 'ping' | 'status';

/**
 * Status of a machine command in its lifecycle.
 */
export type MachineCommandStatus = 'pending' | 'completed' | 'failed';

// ─── Agent Reason Types ───────────────────────────────────────────────────────
//
// Single source of truth for all agent start/stop reasons.
// Uses actor-prefixed dot notation: <actor>.<action>
//
// Actors:
//   user      — human-initiated via UI or CLI
//   platform  — server-side automation (ensure-agent, dedup, team switch)
//   daemon    — machine daemon lifecycle (respawn)

/**
 * Why an agent was started. Used in `agent.requestStart` events.
 *
 * - `user.start`: User explicitly started the agent via UI or CLI
 * - `user.restart`: User explicitly restarted the agent via UI or CLI
 * - `platform.ensure_agent`: Auto-restart triggered by the ensure-agent scheduled check
 * - `platform.crash_recovery`: Eager restart after agent exit when desiredState is 'running' but no active task
 * - `test`: Used in integration and unit tests only
 */
export const AGENT_START_REASONS = [
  'user.start',
  'user.restart',
  'platform.ensure_agent',
  'platform.crash_recovery',
  'test',
] as const;
export type AgentStartReason = (typeof AGENT_START_REASONS)[number];

/**
 * Why an agent was stopped. Used in `agent.requestStop` events and
 * `agent.exited` stopReason field. Same type flows from request through
 * to exit — the daemon passes through the reason it received.
 *
 * - `user.stop`: User explicitly stopped the agent via UI or CLI
 * - `platform.dedup`: Agent stopped to deduplicate roles (another agent took over)
 * - `platform.team_switch`: Agent stopped because the chatroom's team was changed (no auto-restart)
 * - `daemon.respawn`: Daemon killed agent to spawn a fresh instance
 * - `test`: Used in integration and unit tests only
 */
export const AGENT_STOP_REASONS = [
  'user.stop',
  'platform.dedup',
  'platform.team_switch',
  'daemon.respawn',
  'test',
] as const;
export type AgentStopReason = (typeof AGENT_STOP_REASONS)[number];

export const agentStartReasonValidator = v.union(
  ...toLiteralValidators(AGENT_START_REASONS)
);

export const agentStopReasonValidator = v.union(
  ...toLiteralValidators(AGENT_STOP_REASONS)
);

/**
 * Where the agent's AI model was resolved from.
 *
 * - `team_config`: From the team-level agent configuration
 * - `none`: No model configured
 */
export type ModelSource = 'team_config' | 'none';
