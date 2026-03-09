/**
 * Use Case: Get Agent Config
 *
 * Single source of truth for resolving agent configuration from
 * chatroom_teamAgentConfigs. All settings (type, machineId, harness, model,
 * workingDir, spawnedAgentPid, spawnedAt) are read from this table only.
 *
 * Accepts a Convex MutationCtx or QueryCtx as first parameter so it can
 * be called from any handler without coupling to a specific Convex wrapper.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType, ModelSource } from '../../entities/agent';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input parameters for looking up an agent config. */
export interface GetAgentConfigInput {
  /** The chatroom containing the agent. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role of the agent (e.g. "builder", "reviewer"). */
  role: string;
}

/**
 * The resolved agent configuration from chatroom_teamAgentConfigs.
 *
 * This is the single source of truth — all callers should use this type
 * rather than reading the raw tables directly.
 */
export interface ResolvedAgentConfig {
  // ── Identity ─────────────────────────────────────────────────────────

  /** The chatroom this config belongs to. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The agent's role in the chatroom. */
  role: string;

  // ── Team-level config ────────────────────────────────────────────────

  /** Agent type: 'remote' (machine-managed) or 'custom' (user-managed). */
  type: AgentType;
  /** Machine ID (only for remote agents). */
  machineId: string | undefined;
  /** Agent harness (e.g. 'opencode', only for remote agents). */
  agentHarness: AgentHarness | undefined;
  /** Working directory on the machine. */
  workingDir: string | undefined;

  // ── Resolved model ───────────────────────────────────────────────────

  /**
   * The resolved model from team config. If undefined, the daemon will use
   * its default.
   */
  model: string | undefined;

  /** Where the model was resolved from, for debugging. */
  modelSource: ModelSource;

  // ── Runtime state ────────────────────────────────────────────────────

  /** PID of the currently spawned agent. */
  spawnedAgentPid: number | undefined;
  /** When the agent was last spawned. */
  spawnedAt: number | undefined;

  // ── Derived flags ───────────────────────────────────────────────────

  /**
   * Whether this agent has system prompt control (i.e. it's a remote agent
   * whose system prompt the backend can configure). When true, the CLI can
   * skip injecting role/init prompts since they're already in the system prompt.
   */
  hasSystemPromptControl: boolean;
}

/** Result when no team config exists for the role. */
export type GetAgentConfigResult = { found: true; config: ResolvedAgentConfig } | { found: false };

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Resolve the agent configuration for a chatroom + role.
 *
 * Reads from chatroom_teamAgentConfigs only and returns the resolved config.
 *
 * @param ctx - Convex query or mutation context (provides db access)
 * @param input - The lookup parameters
 * @returns The resolved config, or { found: false } if no team config exists
 */
export async function getAgentConfig(
  ctx: QueryCtx | MutationCtx,
  input: GetAgentConfigInput
): Promise<GetAgentConfigResult> {
  const { chatroomId, role } = input;

  // ── Step 1: Look up the chatroom to derive the unique chatroom key ──────

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom) {
    return { found: false };
  }

  if (!chatroom.teamId) {
    // Chatroom has no teamId — cannot build a valid config key
    return { found: false };
  }

  const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, role);

  // ── Step 2: Look up team config ─────────────────────────────────────

  const teamConfig = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  if (!teamConfig) {
    return { found: false };
  }

  // ── Step 3: Resolve model ────────────────────────────────────────────

  const model = teamConfig.model;
  const modelSource: ResolvedAgentConfig['modelSource'] = teamConfig.model
    ? 'team_config'
    : 'none';

  // ── Step 4: Build the resolved config ────────────────────────────────

  const resolvedConfig: ResolvedAgentConfig = {
    chatroomId,
    role: teamConfig.role,
    type: teamConfig.type,
    machineId: teamConfig.machineId,
    agentHarness: teamConfig.agentHarness,
    workingDir: teamConfig.workingDir,
    model,
    modelSource,
    spawnedAgentPid: teamConfig.spawnedAgentPid,
    spawnedAt: teamConfig.spawnedAt,
    hasSystemPromptControl: teamConfig.type === 'remote',
  };

  return { found: true, config: resolvedConfig };
}
