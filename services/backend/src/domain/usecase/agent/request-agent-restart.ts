import { buildAgentRestartEvent } from './build-agent-restart-event';
import { getAgentConfig } from './get-agent-config';
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
import { projectAssignedTaskSnapshotsForChatroom } from '../machine/machine-assigned-task-snapshot-sync';
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

  const overrides = input.request.reason === 'user.restart' ? input.request.overrides : undefined;
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  const resolved: RunnableRemoteAgentConfig = {
    machineId: overrides?.machineId ?? base.machineId,
    agentHarness: overrides?.agentHarness ?? base.agentHarness,
    model: overrides?.model ?? base.model,
    workingDir: overrides?.workingDir ?? base.workingDir,
    wantResume:
      overrides?.wantResume ??
      base.wantResume ??
      (chatroom?.teamId ? resolveDefaultWantResume(chatroom.teamId, input.role) : false),
  };

  if (machine && !machine.availableHarnesses.includes(resolved.agentHarness)) {
    throw new Error(`Agent harness '${resolved.agentHarness}' is not available on this machine`);
  }

  const releasedTaskCount =
    input.request.reason === 'user.restart'
      ? await releaseTasksOnAgentExit(ctx, { chatroomId: input.chatroomId, role: input.role })
      : 0;
  const now = Date.now();
  const correlationId = crypto.randomUUID();

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
  await projectAssignedTaskSnapshotsForChatroom(ctx, input.chatroomId);

  return { status: 'requested', correlationId, releasedTaskCount };
}
