/**
 * Use Case: Get Agent Config
 *
 * Single source of truth for resolving a consolidated agent configuration
 * from the two underlying stores:
 *
 *   1. chatroom_teamAgentConfigs  — team-level settings (type, machineId, harness, model, workingDir)
 *   2. chatroom_machineAgentConfigs — per-machine settings (model, workingDir, PID tracking)
 *
 * The resolved config merges both sources with a clear hierarchy:
 *   - Team config is the primary source (user's confirmed selection)
 *   - Machine config provides fallback values (e.g. model)
 *
 * Accepts a Convex MutationCtx or QueryCtx as first parameter so it can
 * be called from any handler without coupling to a specific Convex wrapper.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType, ModelSource } from '../../model/agent';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input parameters for looking up an agent config. */
export interface GetAgentConfigInput {
  /** The chatroom containing the agent. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role of the agent (e.g. "builder", "reviewer"). */
  role: string;
}

/**
 * The consolidated agent configuration, merging team and machine configs.
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

  // ── Resolved model (config hierarchy) ────────────────────────────────

  /**
   * The resolved model, applying the config hierarchy:
   *   1. teamConfig.model  (user's team-level selection — highest priority)
   *   2. machineConfig.model (machine-specific per chatroom+role)
   *   3. undefined (daemon will use its default)
   */
  model: string | undefined;

  /** Where the model was resolved from, for debugging. */
  modelSource: ModelSource;

  // ── Runtime state (from machine config) ──────────────────────────────

  /** PID of the currently spawned agent (from machine config). */
  spawnedAgentPid: number | undefined;
  /** When the agent was last spawned (from machine config). */
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
 * Resolve the consolidated agent configuration for a chatroom + role.
 *
 * Reads from both `chatroom_teamAgentConfigs` and `chatroom_machineAgentConfigs`,
 * merges them using the config hierarchy, and returns a single resolved config.
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

  // ── Step 1: Look up the chatroom to derive the team ID ───────────────

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom) {
    return { found: false };
  }

  const teamId = chatroom.teamId || chatroom._id;
  const teamRoleKey = `team_${teamId}#role_${role.toLowerCase()}`;

  // ── Step 2: Look up team config (primary source) ─────────────────────

  const teamConfig = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  if (!teamConfig) {
    return { found: false };
  }

  // ── Step 3: Look up machine config (fallback source) ─────────────────

  let machineConfig: {
    model?: string;
    workingDir?: string;
    spawnedAgentPid?: number;
    spawnedAt?: number;
  } | null = null;

  if (teamConfig.machineId) {
    const rawMachineConfig = await ctx.db
      .query('chatroom_machineAgentConfigs')
      .withIndex('by_machine_chatroom_role', (q) =>
        q
          .eq('machineId', teamConfig.machineId!)
          .eq('chatroomId', chatroomId)
          .eq('role', role.toLowerCase())
      )
      .first();

    if (rawMachineConfig) {
      machineConfig = {
        model: rawMachineConfig.model,
        workingDir: rawMachineConfig.workingDir,
        spawnedAgentPid: rawMachineConfig.spawnedAgentPid,
        spawnedAt: rawMachineConfig.spawnedAt,
      };
    }
  }

  // ── Step 4: Resolve model using config hierarchy ─────────────────────

  let model: string | undefined;
  let modelSource: ResolvedAgentConfig['modelSource'];

  if (teamConfig.model) {
    model = teamConfig.model;
    modelSource = 'team_config';
  } else if (machineConfig?.model) {
    model = machineConfig.model;
    modelSource = 'machine_config';
  } else {
    model = undefined;
    modelSource = 'none';
  }

  // ── Step 5: Build the resolved config ────────────────────────────────

  const resolvedConfig: ResolvedAgentConfig = {
    chatroomId,
    role: teamConfig.role,
    type: teamConfig.type,
    machineId: teamConfig.machineId,
    agentHarness: teamConfig.agentHarness,
    workingDir: teamConfig.workingDir ?? machineConfig?.workingDir,
    model,
    modelSource,
    spawnedAgentPid: machineConfig?.spawnedAgentPid,
    spawnedAt: machineConfig?.spawnedAt,
    hasSystemPromptControl: teamConfig.type === 'remote',
  };

  return { found: true, config: resolvedConfig };
}
