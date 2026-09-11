import { getAgentConfig } from './get-agent-config';
import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import { transitionAgentStatus } from './transition-agent-status';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentType } from '../../entities/agent';
import {
  isRunnableRemoteTeamConfig,
  type AgentRestartRequest,
  type AgentRestartResult,
  type RunnableRemoteAgentConfig,
} from '../../entities/agent-restart';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';
import { upsertTeamAgentConfigByTeamRoleKey } from '../machine/patch-team-agent-config';
import { releaseTasksOnAgentExit } from '../task/release-tasks-on-agent-exit';

export async function requestAgentRestart(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    request: AgentRestartRequest;
  },
  machine?: Doc<'chatroom_machines'>
): Promise<AgentRestartResult> {
  const configResult = await getAgentConfig(ctx, input);
  if (!configResult.found || configResult.config.type !== 'remote') {
    return { status: 'skipped', reason: 'no_remote_config' };
  }

  const base = configResult.config;
  if (!isRunnableRemoteTeamConfig(base)) {
    return { status: 'skipped', reason: 'incomplete_remote_config' };
  }

  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  const resolved = resolveRestartOverrides(input.request);

  validateMachineHarness(machine, resolved.agentHarness);

  const releasedTaskCount = await releaseRestartTasks(ctx, {
    chatroomId: input.chatroomId,
    role: input.role,
  });
  const correlationId = crypto.randomUUID();
  await persistRestartAndEmit(ctx, input, resolved, chatroom, correlationId, Date.now());

  return { status: 'requested', correlationId, releasedTaskCount };
}

function resolveRestartOverrides(request: AgentRestartRequest): RunnableRemoteAgentConfig {
  return {
    ...request.overrides,
    wantResume: false,
  };
}

function validateMachineHarness(
  machine: Doc<'chatroom_machines'> | undefined,
  harness: RunnableRemoteAgentConfig['agentHarness']
): void {
  if (machine && !machine.availableHarnesses.includes(harness)) {
    throw new Error(`Agent harness '${harness}' is not available on this machine`);
  }
}

async function releaseRestartTasks(
  ctx: MutationCtx,
  input: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<number> {
  return releaseTasksOnAgentExit(ctx, { chatroomId: input.chatroomId, role: input.role });
}

// fallow-ignore-next-line complexity
async function persistRestartAndEmit(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
  },
  resolved: RunnableRemoteAgentConfig,
  chatroom: Doc<'chatroom_rooms'> | null,
  correlationId: string,
  now: number
): Promise<void> {
  if (chatroom?.teamId) {
    const { wantResume, ...configFields } = resolved;
    await upsertTeamAgentConfigByTeamRoleKey(ctx, {
      teamRoleKey: buildTeamRoleKey(chatroom._id, chatroom.teamId, input.role),
      createdAt: now,
      fields: {
        chatroomId: input.chatroomId,
        role: input.role,
        type: 'remote' as AgentType,
        ...configFields,
        updatedAt: now,
        desiredState: 'running' as const,
        circuitState: 'closed' as const,
        circuitOpenedAt: undefined,
      },
    });
  }
  const teamId = chatroom?.teamId;
  await enqueueMachineCommand(ctx, {
    machineId: resolved.machineId,
    now,
    command: {
      type: 'agent.restart',
      chatroomId: input.chatroomId,
      role: input.role,
      agentHarness: resolved.agentHarness,
      model: resolved.model,
      workingDir: resolved.workingDir,
      correlationId,
      wantResume: resolved.wantResume,
    },
  });
  await transitionAgentStatus(ctx, input.chatroomId, input.role, 'agent.restart', 'running');
  const restartedConfig = teamId
    ? await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(input.chatroomId, teamId, input.role))
        )
        .first()
    : null;
  await projectAgentOperationalStatusForRole(
    ctx,
    input.chatroomId,
    input.role,
    undefined,
    restartedConfig ? { config: restartedConfig } : {}
  );
}
