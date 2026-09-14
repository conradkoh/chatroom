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
  /** Workspace owning this launch configuration, when workspace-scoped. */
  workspaceId?: Id<'chatroom_workspaces'> | undefined;
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

function isEquivalentStartCommand(
  command: MachineCommandPayload,
  input: Pick<StartAgentInput, 'chatroomId' | 'role' | 'agentHarness' | 'model' | 'workingDir'> & {
    wantResume: boolean;
  }
): boolean {
  return (
    command.type === 'agent.requestStart' &&
    command.chatroomId === input.chatroomId &&
    command.role.trim().toLowerCase() === input.role.trim().toLowerCase() &&
    command.agentHarness === input.agentHarness &&
    command.model === input.model &&
    command.workingDir === input.workingDir &&
    command.wantResume === input.wantResume
  );
}

/**
 * Convex-side request deduplication. This is only an enqueue optimization;
 * daemon slot state remains authoritative for whether a process is started.
 */
async function hasEquivalentPendingStart(
  ctx: MutationCtx,
  input: Pick<
    StartAgentInput,
    'machineId' | 'chatroomId' | 'role' | 'agentHarness' | 'model' | 'workingDir'
  > & { wantResume: boolean }
): Promise<boolean> {
  for (const status of ['pending', 'processing'] as const) {
    const rows = await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', input.machineId).eq('status', status)
      )
      .collect();
    if (rows.some((row) => isEquivalentStartCommand(row.command, input))) return true;
  }
  return false;
}

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
  const {
    machineId,
    chatroomId,
    workspaceId,
    role,
    model,
    agentHarness,
    workingDir,
    reason,
    wantResume,
  } = input;

  if (!model.trim() || !workingDir.trim()) {
    throw new Error('Agent model and working directory are required');
  }

  if (isEphemeralAgentRole(role)) {
    throw new Error(
      `Cannot start ephemeral role "${role}" directly. It runs on demand when work is assigned.`
    );
  }

  if (workspaceId) {
    const workspace = await ctx.db.get('chatroom_workspaces', workspaceId);
    const normalize = (value: string) => value.trim().replace(/[/\\]+$/, '');
    if (
      !workspace ||
      workspace.chatroomId !== chatroomId ||
      workspace.removedAt !== undefined ||
      workspace.machineId !== machineId ||
      normalize(workspace.workingDir) !== normalize(workingDir)
    ) {
      throw new Error('Workspace does not belong to this agent start request');
    }
  }

  // ── Step 1: Verify harness is available on the machine ────────────────

  const capabilities = await ctx.db
    .query('chatroom_machineCapabilities')
    .withIndex('by_machineId', (q) => q.eq('machineId', machine.machineId))
    .first();
  if (!capabilities?.availableHarnesses?.includes(agentHarness)) {
    throw new Error(`Agent harness '${agentHarness}' is not available on this machine`);
  }

  // ── Step 2: Resolve request-only defaults ────────────────────────────

  const activeStructure = await getActiveTeamStructure(ctx, chatroomId);
  const structure = activeStructure
    ? getTeamStructure({ teamId: activeStructure.teamStructureId })
    : null;
  const resolvedWantResume =
    wantResume ?? (structure ? resolveDefaultWantResume(structure.teamId, role) : false);

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

  if (await hasEquivalentPendingStart(ctx, { ...input, wantResume: resolvedWantResume })) {
    return { agentHarness, model, workingDir };
  }

  const commandId = await enqueueMachineCommand(ctx, {
    machineId,
    now,
    command: startCommand,
  });

  const isWebappLaunchRequest =
    reason === 'user.start' || reason === 'user.restart' || reason === 'user.manual_spawn';
  if (isWebappLaunchRequest) {
    if (!structure) throw new Error(`Chatroom ${chatroomId} has no team structure`);

    await recordLastSentLaunchRequest(ctx, {
      requestId: startCommand.requestId,
      commandId: commandId.toString(),
      chatroomId,
      workspaceId,
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
