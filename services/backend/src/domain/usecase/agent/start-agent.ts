/**
 * Use Case: Start Agent
 *
 * Encapsulates the complete logic for starting an agent on a machine:
 *   1. Machine agent config upsert (create or update)
 *   2. Machine harness availability check
 *   3. Team agent config upsert (for auto-restart awareness)
 *   4. Command record dispatch
 *
 * All required config values (model, agentHarness, workingDir) must be
 * resolved by the caller before invoking this use case. This ensures the
 * use case is a pure "write what you mean" operation — whatever is passed
 * in is exactly what gets stored and dispatched.
 *
 * Accepts a Convex MutationCtx as first parameter so it can be called from
 * any mutation handler without being coupled to a specific Convex wrapper.
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType, StartAgentReason } from '../../entities/agent';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input parameters for starting an agent. All config values are pre-resolved. */
export interface StartAgentInput {
  /** The machine to start the agent on. */
  machineId: string;
  /** The chatroom containing the agent. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role of the agent (e.g. "builder", "reviewer"). */
  role: string;
  /** The user dispatching the start (must own the machine). */
  userId: Id<'users'>;

  // ── Required config (must be resolved by caller) ──────────────────────

  /** AI model to use (e.g. "anthropic/claude-sonnet-4"). */
  model: string;
  /** Agent harness to use (e.g. 'opencode'). */
  agentHarness: AgentHarness;
  /** Working directory on the machine (absolute path). */
  workingDir: string;

  /**
   * Human-readable reason for this start command.
   * Stored in the command record and logged by the daemon to aid tracing.
   * Examples: 'user-start', 'user-restart', 'ensure-agent-retry'
   */
  reason: StartAgentReason;
}

/** Successful result of a start-agent operation. */
export interface StartAgentResult {
  /** The agent harness used. */
  agentHarness: AgentHarness;
  /** The model used. */
  model: string;
  /** The working directory used. */
  workingDir: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a unique teamRoleKey from a chatroom and role.
 * Format: chatroom_<chatroomId>#role_<roleLowerCase>
 *
 * IMPORTANT: We use chatroom._id (always unique per chatroom) — NOT chatroom.teamId.
 * chatroom.teamId is a static team type string like "duo" or "pair", which is shared
 * across all chatrooms of the same type. Using it as the key would cause configs from
 * different chatrooms to collide and overwrite each other.
 */
function buildTeamRoleKey(chatroom: Doc<'chatroom_rooms'>, role: string): string {
  return `chatroom_${chatroom._id}#role_${role.toLowerCase()}`;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Start an agent by persisting its config and dispatching a start-agent
 * command to the machine daemon.
 *
 * This function is the sole mutator of agent configuration during start
 * operations. Whatever is passed in is exactly what gets stored and dispatched.
 *
 * @param ctx - Convex mutation context (provides db access)
 * @param input - The start parameters (all config values pre-resolved)
 * @param machine - The machine document (pre-fetched by caller for ownership check)
 * @returns The command ID and config used
 * @throws If the harness is not available on the machine
 */
export async function startAgent(
  ctx: MutationCtx,
  input: StartAgentInput,
  machine: Doc<'chatroom_machines'>
): Promise<StartAgentResult> {
  const { machineId, chatroomId, role, model, agentHarness, workingDir, reason } = input;

  // ── Step 1: Upsert machine agent config ───────────────────────────────

  const existingConfig = await ctx.db
    .query('chatroom_machineAgentConfigs')
    .withIndex('by_machine_chatroom_role', (q) =>
      q.eq('machineId', machineId).eq('chatroomId', chatroomId).eq('role', role)
    )
    .first();

  if (existingConfig) {
    await ctx.db.patch('chatroom_machineAgentConfigs', existingConfig._id, {
      agentType: agentHarness,
      workingDir,
      model,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert('chatroom_machineAgentConfigs', {
      machineId,
      chatroomId,
      role,
      agentType: agentHarness,
      workingDir,
      model,
      updatedAt: Date.now(),
    });
  }

  // ── Step 2: Verify harness is available on the machine ────────────────

  if (!machine.availableHarnesses.includes(agentHarness)) {
    throw new Error(`Agent harness '${agentHarness}' is not available on this machine`);
  }

  // ── Step 3: Upsert team agent config ──────────────────────────────────

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (chatroom) {
    const teamRoleKey = buildTeamRoleKey(chatroom, role);
    const existingTeamConfig = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    const teamConfigNow = Date.now();
    const teamConfig = {
      teamRoleKey,
      chatroomId,
      role,
      type: 'remote' as AgentType,
      machineId,
      agentHarness: agentHarness as AgentHarness | undefined,
      model,
      workingDir,
      updatedAt: teamConfigNow,
      desiredState: 'running' as const,
      // Reset circuit breaker — manual start is an explicit user intent to retry
      circuitState: 'closed' as const,
      circuitOpenedAt: undefined,
    };

    if (existingTeamConfig) {
      await ctx.db.patch('chatroom_teamAgentConfigs', existingTeamConfig._id, teamConfig);
    } else {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        ...teamConfig,
        createdAt: teamConfigNow,
      });
    }
  }

  // ── Step 4: Dispatch start-agent command via event stream ────────────

  const now = Date.now();

  // ── Step 5: Write agent.requestStart event to stream ──────────────────

  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.requestStart',
    chatroomId,
    machineId,
    role,
    agentHarness,
    model,
    workingDir,
    reason,
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
  });

  return {
    agentHarness,
    model,
    workingDir,
  };
}
