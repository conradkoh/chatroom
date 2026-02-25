/**
 * Domain Model: Agent
 *
 * Core domain types for agent management. These represent the fundamental
 * concepts in the agent domain — harness types, agent configuration types,
 * command types, and model resolution sources.
 *
 * These are NOT DTOs or intermediate types. They represent the shared
 * vocabulary used across all agent-related use cases.
 */

// ─── Agent Harness ───────────────────────────────────────────────────────────

/**
 * The type of agent harness used to run an agent process.
 *
 * A harness is the execution environment that hosts the AI agent.
 * Supported harnesses: 'opencode', 'pi'.
 */
export type AgentHarness = 'opencode' | 'pi';

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

// ─── Model Resolution ────────────────────────────────────────────────────────

/**
 * Where the agent's AI model was resolved from in the config hierarchy.
 *
 * - `team_config`: From the team-level agent configuration (highest priority)
 * - `machine_config`: From the per-machine agent configuration (fallback)
 * - `none`: No model configured at any level
 */
export type ModelSource = 'team_config' | 'machine_config' | 'none';
