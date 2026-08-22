import { buildAgentRestartEvent } from './build-agent-restart-event';
import { getAgentConfig } from './get-agent-config';
import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import { resolveDefaultWantResume } from './resolve-default-want-resume';
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
import { refreshSnapshotDeliveryConfigForChatroomRole } from '../machine/machine-assigned-task-snapshot-sync';
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
  const resolved = resolveRestartOverrides(input.request, base, chatroom, input.role);

  validateMachineHarness(machine, resolved.agentHarness);

  const releasedTaskCount = await releaseRestartTasks(ctx, input);
  const correlationId = crypto.randomUUID();
  await persistRestartAndEmit(ctx, input, resolved, chatroom, correlationId, Date.now());

  return { status: 'requested', correlationId, releasedTaskCount };
}

function resolveRestartOverrides(
  request: AgentRestartRequest,
  base: Omit<RunnableRemoteAgentConfig, 'wantResume'> & { wantResume?: boolean },
  chatroom: Doc<'chatroom_rooms'> | null,
  role: string
): RunnableRemoteAgentConfig {
  const overrides = request.reason === 'user.restart' ? request.overrides : undefined;
  const source = Object.assign({}, base, overrides);
  return {
    machineId: source.machineId,
    agentHarness: source.agentHarness,
    model: source.model,
    workingDir: source.workingDir,
    wantResume: source.wantResume ?? defaultWantResume(chatroom, role),
  };
}

function defaultWantResume(chatroom: Doc<'chatroom_rooms'> | null, role: string): boolean {
  return chatroom?.teamId ? resolveDefaultWantResume(chatroom.teamId, role) : false;
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
  input: { chatroomId: Id<'chatroom_rooms'>; role: string; request: AgentRestartRequest }
): Promise<number> {
  if (input.request.reason !== 'user.restart') return 0;
  return releaseTasksOnAgentExit(ctx, { chatroomId: input.chatroomId, role: input.role });
}

// fallow-ignore-next-line complexity
async function persistRestartAndEmit(
  ctx: MutationCtx,
  input: { chatroomId: Id<'chatroom_rooms'>; role: string },
  resolved: RunnableRemoteAgentConfig,
  chatroom: Doc<'chatroom_rooms'> | null,
  correlationId: string,
  now: number
): Promise<void> {
  if (chatroom?.teamId) {
    await upsertTeamAgentConfigByTeamRoleKey(ctx, {
      teamRoleKey: buildTeamRoleKey(chatroom._id, chatroom.teamId, input.role),
      createdAt: now,
      fields: {
        chatroomId: input.chatroomId,
        role: input.role,
        type: 'remote' as AgentType,
        ...resolved,
        updatedAt: now,
        desiredState: 'running' as const,
        circuitState: 'closed' as const,
        circuitOpenedAt: undefined,
      },
    });
  }
  await ctx.db.insert(
    'chatroom_eventStream',
    buildAgentRestartEvent(
      { ...resolved, chatroomId: input.chatroomId, role: input.role, correlationId },
      now
    )
  );
  await transitionAgentStatus(ctx, input.chatroomId, input.role, 'agent.restart', 'running');
  await refreshSnapshotDeliveryConfigForChatroomRole(ctx, input.chatroomId, input.role);
  const teamId = chatroom?.teamId;
  const restartedConfig = teamId
    ? await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(input.chatroomId, teamId, input.role))
        )
        .first()
    : null;
  await projectAgentOperationalStatusForRole(ctx, input.chatroomId, input.role, undefined, {
    config: restartedConfig ?? undefined,
  });
}
