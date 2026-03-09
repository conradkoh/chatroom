/**
 * Use Case: Start Agent
 *
 * Encapsulates the complete logic for starting an agent on a machine:
 *   1. Machine harness availability check
 *   2. Team agent config upsert (for auto-restart awareness)
 *   3. Command record dispatch
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
import type { AgentHarness, AgentStartReason, AgentType } from '../../entities/agent';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

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
   * Examples: 'user.start', 'user.restart', 'platform.ensure_agent'
   */
  reason: AgentStartReason;
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

  // ── Step 1: Verify harness is available on the machine ────────────────

  if (!machine.availableHarnesses.includes(agentHarness)) {
    throw new Error(`Agent harness '${agentHarness}' is not available on this machine`);
  }

  // ── Step 2: Upsert team agent config ──────────────────────────────────

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (chatroom) {
    if (!chatroom.teamId) {
      throw new Error(`Chatroom ${chatroomId} has no teamId — cannot build agent config key`);
    }
    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, role);
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

  // ── Step 3: Write agent.requestStart event to stream ──────────────────

  const now = Date.now();

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
