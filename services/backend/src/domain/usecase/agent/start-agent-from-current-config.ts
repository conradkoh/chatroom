import { assertMachineBelongsToChatroom } from './assert-machine-belongs-to-chatroom';
import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { startAgent } from './start-agent';
import { normalizeWorkingDir } from './workspace-match';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { AgentStartReasonCode } from '../../entities/agent';
import type { TeamStructure } from '../../entities/team-presets';
import { resolveChatroomTeamStructure } from '../team/resolve-chatroom-team';
import { getPrimaryWorkspaceForChatroom } from '../workspace/get-primary-workspace-for-chatroom';

export type StartAgentFromCurrentConfigResult =
  | { status: 'started'; role: string; machineId: string }
  | { status: 'skipped'; role: string; reason: string };

type LastSentLaunchRequest = Doc<'chatroom_agentLastSentLaunchRequests'>;
type Workspace = Doc<'chatroom_workspaces'>;
type Machine = Doc<'chatroom_machines'>;

type StartSkip = Extract<StartAgentFromCurrentConfigResult, { status: 'skipped' }>;

/** A step either produces the value the next step needs, or a skip result. */
type StepResult<Value> = { kind: 'ready'; value: Value } | { kind: 'skipped'; skip: StartSkip };

function skip(role: string, reason: string): StepResult<never> {
  return { kind: 'skipped', skip: { status: 'skipped', role, reason } };
}

/**
 * Role membership is case-insensitive so a caller's casing never decides
 * whether a configured role can start.
 */
function isRoleInTeam(team: TeamStructure, role: string): boolean {
  return team.roles.some((candidate) => candidate.role.toLowerCase() === role.toLowerCase());
}

/** A workspace is usable only when it belongs to this chatroom and is not removed. */
function isWorkspaceActiveInChatroom(workspace: Workspace, chatroomId: Id<'chatroom_rooms'>) {
  return workspace.chatroomId === chatroomId && workspace.removedAt === undefined;
}

function isPresent(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

function hasTrimmedValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

/**
 * A saved launch request is only replayable when every field the daemon needs
 * is present and non-blank.
 */
function isLaunchRequestComplete(request: LastSentLaunchRequest): boolean {
  return (
    isPresent(request.machineId) &&
    isPresent(request.agentHarness) &&
    hasTrimmedValue(request.model) &&
    hasTrimmedValue(request.workingDir)
  );
}

/**
 * The request must still target the workspace it will be started against;
 * otherwise it is a stale snapshot from a moved or re-registered workspace.
 */
function launchRequestBelongsToWorkspace(
  request: LastSentLaunchRequest,
  workspace: Workspace
): boolean {
  return (
    request.machineId === workspace.machineId &&
    normalizeWorkingDir(request.workingDir) === normalizeWorkingDir(workspace.workingDir)
  );
}

/** The workspace the caller named, or the chatroom's primary workspace. */
async function resolveStartWorkspace(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    workspaceId?: Id<'chatroom_workspaces'> | undefined;
  },
  role: string
): Promise<StepResult<Workspace>> {
  const workspace = input.workspaceId
    ? await ctx.db.get('chatroom_workspaces', input.workspaceId)
    : await getPrimaryWorkspaceForChatroom(ctx, input.chatroomId, { fallbackToNewest: false });
  if (!workspace) return skip(role, 'No active primary workspace');
  if (!isWorkspaceActiveInChatroom(workspace, input.chatroomId)) {
    return skip(role, 'Workspace is not active in this chatroom');
  }
  return { kind: 'ready', value: workspace };
}

/**
 * Resolves the workspace for a role that the chatroom resolver says is a member
 * of the active team, so enabled custom agents are startable here too. The room
 * is passed as `legacyRoom` so a non-preset structure id keeps the persisted
 * roles master used.
 */
async function resolveStartContext(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    workspaceId?: Id<'chatroom_workspaces'> | undefined;
  },
  role: string
): Promise<StepResult<Workspace>> {
  const room = await ctx.db.get('chatroom_rooms', input.chatroomId);
  const team = await resolveChatroomTeamStructure(ctx, input.chatroomId, { legacyRoom: room });
  if (!team) return skip(role, 'No active team structure');
  if (!isRoleInTeam(team, role)) return skip(role, 'Role is not part of the active team');
  return resolveStartWorkspace(ctx, input, role);
}

/** Reads the last-sent launch request for this workspace and role. */
async function resolveSavedLaunchRequest(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  workspaceId: Id<'chatroom_workspaces'>,
  role: string
): Promise<StepResult<LastSentLaunchRequest>> {
  const request = await getLastSentLaunchRequestForRole(ctx, { chatroomId, role, workspaceId });
  if (!request) return skip(role, 'No saved launch configuration');
  if (!isLaunchRequestComplete(request)) {
    return skip(role, 'Saved launch configuration is incomplete');
  }
  return { kind: 'ready', value: request };
}

/**
 * The saved machine must still be registered and owned by the requester; the
 * caller never supplies machine identity directly.
 */
async function resolveSavedMachine(
  ctx: MutationCtx,
  request: LastSentLaunchRequest,
  requestedBy: Id<'users'>,
  role: string
): Promise<StepResult<Machine>> {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', request.machineId))
    .first();
  if (!machine) return skip(role, 'Saved machine is no longer registered');
  if (machine.userId !== requestedBy) {
    return skip(role, 'Saved machine is not owned by the requester');
  }
  return { kind: 'ready', value: machine };
}

/** Resolves the saved request and machine as one launch configuration. */
async function resolveLaunchForStart(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    requestedBy: Id<'users'>;
  },
  role: string,
  workspace: Workspace
): Promise<StepResult<{ request: LastSentLaunchRequest; machine: Machine }>> {
  const saved = await resolveSavedLaunchRequest(ctx, input.chatroomId, workspace._id, role);
  if (saved.kind === 'skipped') return saved;

  const machine = await resolveSavedMachine(ctx, saved.value, input.requestedBy, role);
  if (machine.kind === 'skipped') return machine;

  if (!launchRequestBelongsToWorkspace(saved.value, workspace)) {
    return skip(role, 'Saved launch configuration is not for the active workspace');
  }
  return { kind: 'ready', value: { request: saved.value, machine: machine.value } };
}

/**
 * Start a configured role from the last configuration recorded for the
 * chatroom's active workspace. The caller may identify the workspace, while
 * machine identity and launch settings are always resolved from backend state.
 * Role membership comes from the chatroom resolver, so custom agents are startable.
 *
 * Skip precedence is part of the contract: role validation, then team
 * membership, then workspace selection, then the saved launch request, and
 * finally machine ownership and workspace matching.
 */
export async function startAgentFromCurrentWorkspaceConfig(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    workspaceId?: Id<'chatroom_workspaces'> | undefined;
    role: string;
    requestedBy: Id<'users'>;
  }
): Promise<StartAgentFromCurrentConfigResult> {
  const role = input.role.trim();
  if (!role) return { status: 'skipped', role, reason: 'Role is required' };

  const context = await resolveStartContext(ctx, input, role);
  if (context.kind === 'skipped') return context.skip;

  const launch = await resolveLaunchForStart(ctx, input, role, context.value);
  if (launch.kind === 'skipped') return launch.skip;

  await assertMachineBelongsToChatroom(ctx, {
    chatroomId: input.chatroomId,
    machineId: launch.value.request.machineId,
    role,
    allowNewMachine: false,
  });

  await startAgent(
    ctx,
    {
      machineId: launch.value.request.machineId,
      chatroomId: input.chatroomId,
      workspaceId: context.value._id,
      role,
      userId: input.requestedBy,
      model: launch.value.request.model,
      agentHarness: launch.value.request.agentHarness,
      workingDir: launch.value.request.workingDir,
      reason: AgentStartReasonCode.USER_START,
      wantResume: launch.value.request.wantResume,
    },
    launch.value.machine
  );

  return { status: 'started', role, machineId: launch.value.request.machineId };
}

export type StartAgentsResult = {
  started: string[];
  skipped: { role: string; reason: string }[];
  failed: { role: string; error: string }[];
};

export async function startAgentsFromCurrentConfig(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    workspaceId?: Id<'chatroom_workspaces'> | undefined;
    roles: readonly string[];
    requestedBy: Id<'users'>;
  }
): Promise<StartAgentsResult> {
  const outcomes = await Promise.all(
    input.roles.map(
      async (
        role
      ): Promise<
        | { kind: 'started'; role: string }
        | { kind: 'skipped'; role: string; reason: string }
        | { kind: 'failed'; role: string; error: string }
      > => {
        try {
          const started = await startAgentFromCurrentWorkspaceConfig(ctx, {
            chatroomId: input.chatroomId,
            workspaceId: input.workspaceId,
            role,
            requestedBy: input.requestedBy,
          });
          if (started.status === 'started') return { kind: 'started', role: started.role };
          return { kind: 'skipped', role: started.role, reason: started.reason };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[agents] failed to start ${role}@${input.chatroomId}: ${message}`);
          return { kind: 'failed', role, error: message };
        }
      }
    )
  );

  const result: StartAgentsResult = { started: [], skipped: [], failed: [] };
  for (const outcome of outcomes) {
    if (outcome.kind === 'started') result.started.push(outcome.role);
    else if (outcome.kind === 'skipped') {
      result.skipped.push({ role: outcome.role, reason: outcome.reason });
    } else {
      result.failed.push({ role: outcome.role, error: outcome.error });
    }
  }
  return result;
}
