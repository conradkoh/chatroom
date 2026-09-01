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

import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { advanceAgentLifecycleRevision } from './advance-agent-lifecycle-revision';
import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import { resolveDefaultWantResume } from './resolve-default-want-resume';
import { supersedeInflightAgentStopCommands } from './supersede-inflight-agent-stop-commands';
import { transitionAgentStatus } from './transition-agent-status';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentHarness, AgentStartReason, AgentType } from '../../entities/agent';
import type { CodexMaxReasoningLevel } from '../../entities/harness/codex-sdk.model-variants';
import type { MachineCommandPayload } from '../../entities/machine-command';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';
import { refreshSnapshotDeliveryConfigForChatroomRole } from '../machine/machine-assigned-task-snapshot-sync';
import { upsertTeamAgentConfigByTeamRoleKey } from '../machine/patch-team-agent-config';

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
   * Examples: 'user.start', 'user.restart', 'platform.crash_recovery'
   */
  reason: AgentStartReason;
  /**
   * When true, resume-capable harnesses try to continue from the daemon's last
   * session. For user starts this is runtime-only and is not persisted.
   */
  wantResume?: boolean;
  lifecycleRevision?: number;
  /** Codex SDK max reasoning effort cap; only persisted for codex-sdk harness. */
  maxReasoningLevel?: CodexMaxReasoningLevel;
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
// fallow-ignore-next-line complexity
export async function startAgent(
  ctx: MutationCtx,
  input: StartAgentInput,
  machine: Doc<'chatroom_machines'>
): Promise<StartAgentResult> {
  const { machineId, chatroomId, role, model, agentHarness, workingDir, reason, wantResume } =
    input;
  const effectiveMaxReasoningLevel =
    agentHarness === 'codex-sdk' ? input.maxReasoningLevel : undefined;

  if (isEphemeralAgentRole(role)) {
    throw new Error(
      `Cannot start ephemeral role "${role}" directly. It runs on demand when work is assigned.`
    );
  }

  if (reason === 'user.start' || reason === 'user.restart')
    await supersedeInflightAgentStopCommands(ctx, { chatroomId });

  // ── Step 1: Verify harness is available on the machine ────────────────

  if (!machine.availableHarnesses.includes(agentHarness)) {
    throw new Error(`Agent harness '${agentHarness}' is not available on this machine`);
  }

  // ── Step 2: Upsert team agent config ──────────────────────────────────

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const resolvedWantResume =
    wantResume ?? (chatroom?.teamId ? resolveDefaultWantResume(chatroom.teamId, role) : false);

  if (chatroom) {
    if (!chatroom.teamId) {
      throw new Error(`Chatroom ${chatroomId} has no teamId — cannot build agent config key`);
    }
    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, role);
    const teamConfigNow = Date.now();

    const { previousMachineId } = await upsertTeamAgentConfigByTeamRoleKey(ctx, {
      teamRoleKey,
      createdAt: teamConfigNow,
      fields: {
        chatroomId,
        role,
        type: 'remote' as AgentType,
        machineId,
        agentHarness,
        model,
        workingDir,
        updatedAt: teamConfigNow,
        desiredState: 'running' as const,
        ...(reason !== 'user.start' && reason !== 'user.restart'
          ? { wantResume: resolvedWantResume }
          : {}),
        circuitState: 'closed' as const,
        circuitOpenedAt: undefined,
        ...(effectiveMaxReasoningLevel !== undefined
          ? { maxReasoningLevel: effectiveMaxReasoningLevel }
          : agentHarness !== 'codex-sdk'
            ? { maxReasoningLevel: undefined }
            : {}),
      },
    });

    const currentConfig = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();
    if (currentConfig) {
      const lifecycleRevision = await advanceAgentLifecycleRevision(ctx, currentConfig._id);
      input.lifecycleRevision = lifecycleRevision;
    }

    if (previousMachineId != null && previousMachineId !== machineId) {
    }
  }

  // ── Step 3: Write agent.requestStart event to stream ──────────────────

  const now = Date.now();

  const startCommand: Extract<MachineCommandPayload, { type: 'agent.requestStart' }> = {
    type: 'agent.requestStart',
    chatroomId,
    role,
    agentHarness,
    model,
    workingDir,
    reason,
    wantResume: resolvedWantResume,
    ...(input.lifecycleRevision !== undefined
      ? { lifecycleRevision: input.lifecycleRevision }
      : {}),
    ...(effectiveMaxReasoningLevel !== undefined
      ? { maxReasoningLevel: effectiveMaxReasoningLevel }
      : {}),
  };

  await enqueueMachineCommand(ctx, {
    machineId,
    now,
    command: startCommand,
  });
  await transitionAgentStatus(ctx, chatroomId, role, 'agent.requestStart', 'running');

  // Refresh the daemon snapshot projection so the task monitor sees the new
  // config (desiredState/model/workingDir) without waiting for a task transition.
  // Refresh delivery-config fields on snapshot rows (harness/model/workingDir).
  // Operational state (desiredState/PID) is NOT written to snapshots — daemon reads operational projection.
  await refreshSnapshotDeliveryConfigForChatroomRole(ctx, chatroomId, role);
  const startedConfig = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, chatroom?.teamId ?? '', role))
    )
    .first();
  await projectAgentOperationalStatusForRole(
    ctx,
    chatroomId,
    role,
    undefined,
    startedConfig ? { config: startedConfig } : {}
  );

  return {
    agentHarness,
    model,
    workingDir,
  };
}
