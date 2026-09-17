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
import { getActiveTeamStructure } from '../team/active-team-structure';

export async function requestAgentRestart(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    workspaceId?: Id<'chatroom_workspaces'> | undefined;
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

  await validateMachineHarness(ctx, machine, resolved.agentHarness);

  const correlationId = crypto.randomUUID();
  await persistRestartAndEmit(ctx, input, resolved, correlationId, Date.now());

  return { status: 'requested', correlationId };
}

function resolveRestartOverrides(request: AgentRestartRequest): RunnableRemoteAgentConfig {
  return {
    ...request.overrides,
    wantResume: false,
  };
}

async function validateMachineHarness(
  ctx: MutationCtx,
  machine: Doc<'chatroom_machines'> | undefined,
  harness: RunnableRemoteAgentConfig['agentHarness']
): Promise<void> {
  if (!machine) return;
  const capabilities = await ctx.db
    .query('chatroom_machineCapabilities')
    .withIndex('by_machineId', (q) => q.eq('machineId', machine.machineId))
    .first();
  if (!capabilities?.availableHarnesses?.includes(harness)) {
    throw new Error(`Agent harness '${harness}' is not available on this machine`);
  }
}

// Task release is no longer decided here: in-flight tasks stay untouched until
// the owning machine's agent process service notifies its task service
// (`handleAgentRestart`), which decides what to do with them.

// fallow-ignore-next-line complexity
async function persistRestartAndEmit(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    workspaceId?: Id<'chatroom_workspaces'> | undefined;
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
  const structure = activeStructure
    ? getTeamStructure({ teamId: activeStructure.teamStructureId })
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
    workspaceId: input.workspaceId,
    agentHarness: resolved.agentHarness,
    model: resolved.model,
    workingDir: resolved.workingDir,
    reason: input.request.reason,
    wantResume: resolved.wantResume,
    requestedBy: input.requestedBy,
    requestedAt: now,
  });
}
