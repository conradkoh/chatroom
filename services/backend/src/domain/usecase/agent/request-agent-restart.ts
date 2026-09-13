import { getAgentConfig } from './get-agent-config';
import { recordLastSentLaunchRequest } from './record-last-sent-launch-request';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import {
  isRunnableRemoteTeamConfig,
  type AgentRestartRequest,
  type AgentRestartResult,
  type RunnableRemoteAgentConfig,
} from '../../entities/agent-restart';
import { getTeamStructure } from '../../entities/team-presets';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';
import { releaseTasksOnAgentExit } from '../task/release-tasks-on-agent-exit';
import { getActiveTeamStructure } from '../team/active-team-structure';

export async function requestAgentRestart(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    requestedBy: Id<'users'>;
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

  const resolved = resolveRestartOverrides(input.request);

  validateMachineHarness(machine, resolved.agentHarness);

  const releasedTaskCount = await releaseRestartTasks(ctx, {
    chatroomId: input.chatroomId,
    role: input.role,
  });
  const correlationId = crypto.randomUUID();
  await persistRestartAndEmit(ctx, input, resolved, correlationId, Date.now());

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
    requestedBy: Id<'users'>;
    request: AgentRestartRequest;
  },
  resolved: RunnableRemoteAgentConfig,
  correlationId: string,
  now: number
): Promise<void> {
  const requestId = correlationId;
  const commandId = await enqueueMachineCommand(ctx, {
    machineId: resolved.machineId,
    now,
    command: {
      type: 'agent.restart',
      requestId,
      chatroomId: input.chatroomId,
      role: input.role,
      agentHarness: resolved.agentHarness,
      model: resolved.model,
      workingDir: resolved.workingDir,
      correlationId,
      wantResume: resolved.wantResume,
    },
  });
  const activeStructure = await getActiveTeamStructure(ctx, input.chatroomId);
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
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
  if (!structure) throw new Error(`Chatroom ${input.chatroomId} has no team structure`);
  await recordLastSentLaunchRequest(ctx, {
    requestId,
    commandId: commandId.toString(),
    chatroomId: input.chatroomId,
    teamStructureId: structure.teamStructureId,
    role: input.role,
    agentType: 'remote',
    machineId: resolved.machineId,
    agentHarness: resolved.agentHarness,
    model: resolved.model,
    workingDir: resolved.workingDir,
    reason: input.request.reason,
    wantResume: resolved.wantResume,
    requestedBy: input.requestedBy,
    requestedAt: now,
  });
}
