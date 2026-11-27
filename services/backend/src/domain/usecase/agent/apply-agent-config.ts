import { ConvexError } from 'convex/values';

import { requestAgentRestart } from './request-agent-restart';
import { type AgentConfigTarget } from './resolve-agent-config-target';
import { saveAgentConfig } from './save-agent-config';
import { selectWakeableAgentRoles } from './select-wakeable-agent-roles';
import { BACKEND_ERROR_CODES, type BackendError } from '../../../../config/errorCodes';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { AgentStartReasonCode, type AgentHarness } from '../../entities/agent';
import { getMachineAvailableModels } from '../machine/machine-available-models';

export interface ApplyAgentConfigInput {
  target: AgentConfigTarget;
  chatroomId: Id<'chatroom_rooms'>;
  /** Untyped on purpose: an unknown harness must yield a friendly AGENT_CONFIG_HARNESS_UNAVAILABLE */
  agentHarness: string;
  model: string;
  requestedBy: Id<'users'>;
  machine: Doc<'chatroom_machines'>;
}

type ApplyAgentConfigOutcome = 'unchanged' | 'saved' | 'restarted';

export interface ApplyAgentConfigResult {
  role: string;
  outcome: ApplyAgentConfigOutcome;
  /** Projected status is online (starting|waiting|working|stopping) for this role in this workspace */
  running: boolean;
  previous: { agentHarness: string; model: string } | null;
  effective: {
    agentHarness: string;
    model: string;
    machineId: string;
    workingDir: string;
    workspaceId: Id<'chatroom_workspaces'>;
  };
  correlationId?: string | undefined;
}

/**
 * Persists a role's harness and model and decides, in one transaction, whether a restart is needed.
 *
 * - unchanged: nothing is written and nothing is queued.
 * - changed and not running (or no previous config): saved only.
 * - changed and running: `requestAgentRestart` persists the new config and enqueues exactly one
 *   `agent.restart`. It is never combined with `saveAgentConfig`, which would be a second write.
 */
// fallow-ignore-next-line complexity
export async function applyAgentConfig(
  ctx: MutationCtx,
  input: ApplyAgentConfigInput
): Promise<ApplyAgentConfigResult> {
  const { target } = input;
  const model = input.model.trim();
  await assertAvailableOnMachine(ctx, input.machine.machineId, input.agentHarness, model);
  const harness = input.agentHarness as AgentHarness; // validated against the machine list above

  if (target.previous && target.previous.agentType !== 'remote') {
    throw new ConvexError<BackendError>({
      code: BACKEND_ERROR_CODES.AGENT_CONFIG_NOT_REMOTE,
      message: `Role ${target.role} is a custom agent; its harness and model cannot be set from here`,
    });
  }

  const previous = target.previous
    ? { agentHarness: target.previous.agentHarness, model: target.previous.model }
    : null;
  const running = await isTargetRunning(ctx, input.chatroomId, target);
  const base = {
    role: target.role,
    running,
    previous,
    effective: {
      agentHarness: harness,
      model,
      machineId: target.machineId,
      workingDir: target.workingDir,
      workspaceId: target.workspace._id,
    },
  };

  const changed =
    previous === null || previous.agentHarness !== harness || previous.model.trim() !== model;
  if (!changed) return { ...base, outcome: 'unchanged' };

  // Saved only: nothing to restart from (no previous config), or the agent is not running.
  if (!target.previous || !running) {
    await saveAgentConfig(ctx, {
      chatroomId: input.chatroomId,
      workspaceId: target.workspace._id,
      role: target.role,
      machineId: target.machineId,
      agentHarness: harness,
      model,
      workingDir: target.workingDir,
      requestedBy: input.requestedBy,
    });
    return { ...base, outcome: 'saved' };
  }

  // Changed and running: requestAgentRestart persists the config and enqueues exactly one agent.restart.
  const restart = await requestAgentRestart(
    ctx,
    {
      chatroomId: input.chatroomId,
      workspaceId: target.workspace._id,
      role: target.role,
      requestedBy: input.requestedBy,
      request: {
        reason: AgentStartReasonCode.USER_RESTART,
        overrides: {
          machineId: target.machineId,
          agentHarness: harness,
          model,
          workingDir: target.workingDir,
        },
      },
    },
    input.machine
  );
  if (restart.status === 'skipped') throw new Error(`Cannot restart agent: ${restart.reason}`);
  return { ...base, outcome: 'restarted', correlationId: restart.correlationId };
}

/** Harness must be on the machine; model must be non-empty and, when the harness catalog is non-empty, listed. */
// fallow-ignore-next-line complexity
async function assertAvailableOnMachine(
  ctx: MutationCtx,
  machineId: string,
  harness: string,
  model: string
): Promise<void> {
  const capabilities = await ctx.db
    .query('chatroom_machineCapabilities')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  const availableHarnesses = capabilities?.availableHarnesses ?? [];
  if (!availableHarnesses.some((candidate) => candidate === harness)) {
    throw new ConvexError<BackendError>({
      code: BACKEND_ERROR_CODES.AGENT_CONFIG_HARNESS_UNAVAILABLE,
      message: `Agent harness '${harness}' is not available on this machine. Available: ${availableHarnesses.join(', ') || 'none'}`,
    });
  }
  if (!model) throw new Error('Agent model is required');
  const catalog =
    (await getMachineAvailableModels(ctx, machineId)) ?? capabilities?.availableModels ?? {};
  const models = catalog[harness] ?? [];
  if (models.length > 0 && !models.includes(model)) {
    throw new ConvexError<BackendError>({
      code: BACKEND_ERROR_CODES.AGENT_CONFIG_MODEL_UNAVAILABLE,
      message: `Model '${model}' is not available for ${harness} on this machine. Run \`chatroom agent config models\` to list the models for this harness.`,
    });
  }
}

/** Running = online per the projected status row for this role in this workspace (daemon-authoritative projection). */
async function isTargetRunning(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  target: AgentConfigTarget
): Promise<boolean> {
  const statusRows = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  return (
    selectWakeableAgentRoles({
      roles: [target.role],
      workspaceId: target.workspace._id,
      statusRows,
    }).length === 0
  );
}
