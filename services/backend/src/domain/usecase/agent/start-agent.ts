/**
 * Use Case: Start Agent
 *
 * Encapsulates the complete logic for starting an agent on a machine:
 *   1. Machine harness availability check
 *   2. Desired agent config upsert for explicit user starts
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

import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { recordLastSentLaunchRequest } from './record-last-sent-launch-request';
import { resolveDefaultWantResume } from './resolve-default-want-resume';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentStartReason } from '../../entities/agent';
import type { MachineCommandPayload } from '../../entities/machine-command';
import { getTeamStructure } from '../../entities/team-presets';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';
import { getActiveTeamStructure } from '../team/active-team-structure';

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
   * Examples: 'user.start', 'user.restart', 'platform.task_monitor_nudge'
   */
  reason: AgentStartReason;
  /**
   * When true, resume-capable harnesses try to continue from the daemon's last
   * session. For user starts this is runtime-only and is not persisted.
   */
  wantResume?: boolean | undefined;
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
 * Start an agent by snapshotting the submitted request and dispatching a
 * self-contained start-agent command to the machine daemon.
 *
 * The daemon owns the resulting lifecycle. Convex does not mark the agent as
 * running until a daemon observation is received.
 *
 * @param ctx - Convex mutation context (provides db access)
 * @param input - The start parameters (all config values pre-resolved)
 * @param machine - The machine document (pre-fetched by caller for ownership check)
 * @returns The command ID and config used
 * @throws If the harness is not available on the machine
 */
// fallow-ignore-next-line complexity
export async function startAgent(
  ctx: MutationCtx,
  input: StartAgentInput,
  machine: Doc<'chatroom_machines'>
): Promise<StartAgentResult> {
  const { machineId, chatroomId, role, model, agentHarness, workingDir, reason, wantResume } =
    input;

  if (isEphemeralAgentRole(role)) {
    throw new Error(
      `Cannot start ephemeral role "${role}" directly. It runs on demand when work is assigned.`
    );
  }

  // ── Step 1: Verify harness is available on the machine ────────────────

  if (!machine.availableHarnesses.includes(agentHarness)) {
    throw new Error(`Agent harness '${agentHarness}' is not available on this machine`);
  }

  // ── Step 2: Resolve request-only defaults ────────────────────────────

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const resolvedWantResume =
    wantResume ?? (chatroom?.teamId ? resolveDefaultWantResume(chatroom.teamId, role) : false);

  // ── Step 3: Write the self-contained agent.requestStart command ───────

  const now = Date.now();

  const startCommand: Extract<MachineCommandPayload, { type: 'agent.requestStart' }> = {
    type: 'agent.requestStart',
    requestId: crypto.randomUUID(),
    chatroomId,
    role,
    agentHarness,
    model,
    workingDir,
    reason,
    wantResume: resolvedWantResume,
  };

  const commandId = await enqueueMachineCommand(ctx, {
    machineId,
    now,
    command: startCommand,
  });

  const isWebappLaunchRequest =
    reason === 'user.start' || reason === 'user.restart' || reason === 'user.manual_spawn';
  if (isWebappLaunchRequest) {
    const activeStructure = await getActiveTeamStructure(ctx, chatroomId);
    const structure = activeStructure
      ? getTeamStructure({ teamId: activeStructure.teamStructureId })
      : chatroom?.teamId
        ? getTeamStructure({
            teamId: chatroom.teamId,
            ...(chatroom.teamName !== undefined ? { teamName: chatroom.teamName } : {}),
            ...(chatroom.teamRoles !== undefined ? { persistedRoles: chatroom.teamRoles } : {}),
            ...(chatroom.teamEntryPoint !== undefined
              ? { persistedEntryPoint: chatroom.teamEntryPoint }
              : {}),
          })
        : null;
    if (!structure) throw new Error(`Chatroom ${chatroomId} has no team structure`);

    await recordLastSentLaunchRequest(ctx, {
      requestId: startCommand.requestId,
      commandId: commandId.toString(),
      chatroomId,
      teamStructureId: structure.teamStructureId,
      role,
      agentType: 'remote',
      machineId,
      agentHarness,
      model,
      workingDir,
      reason,
      wantResume: resolvedWantResume,
      requestedBy: input.userId,
      requestedAt: now,
    });
  }
  return {
    agentHarness,
    model,
    workingDir,
  };
}
