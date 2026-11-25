import { recordLastSentLaunchRequest } from './record-last-sent-launch-request';
import { normalizeWorkingDir } from './workspace-match';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { validateWorkingDir } from '../../../../convex/workspacePathSecurity';
import type { AgentHarness } from '../../entities/agent';
import { getActiveTeamStructure } from '../team/active-team-structure';

export interface SaveAgentConfigInput {
  chatroomId: Id<'chatroom_rooms'>;
  workspaceId: Id<'chatroom_workspaces'>;
  role: string;
  machineId: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  requestedBy: Id<'users'>;
}

/**
 * Persists an agent configuration as the latest sent launch request. Starts no agent.
 *
 * The caller owns session authentication (`requireChatroomAccess` / `requireMachineOwner`): this
 * use case takes no session. Checks run in the same order as the web mutation always did, and the
 * stored `model` is untrimmed — only the emptiness check trims.
 */
export async function saveAgentConfig(
  ctx: MutationCtx,
  a: SaveAgentConfigInput
): Promise<Doc<'chatroom_agentLastSentLaunchRequests'>> {
  assertConfigInput(a);
  await requireWorkspaceForConfig(ctx, a);
  await assertHarnessAvailable(ctx, a);
  const activeStructure = await requireTeamStructure(ctx, a.chatroomId);

  const requestId = crypto.randomUUID();
  return recordLastSentLaunchRequest(ctx, {
    requestId,
    commandId: `configuration:${requestId}`,
    chatroomId: a.chatroomId,
    teamStructureId: activeStructure.teamStructureId,
    role: a.role,
    agentType: 'remote',
    machineId: a.machineId,
    workspaceId: a.workspaceId,
    agentHarness: a.agentHarness,
    model: a.model, // untrimmed, as today
    workingDir: a.workingDir,
    reason: 'user.config',
    wantResume: false,
    requestedBy: a.requestedBy,
    requestedAt: Date.now(),
  });
}

/** The two input checks, in the order the web mutation has always run them. */
function assertConfigInput(a: SaveAgentConfigInput): void {
  validateWorkingDir(a.workingDir);
  if (!a.model.trim()) throw new Error('Agent model is required');
}

/** The configured workspace must be the same live workspace on the same machine. */
async function requireWorkspaceForConfig(ctx: MutationCtx, a: SaveAgentConfigInput): Promise<void> {
  const workspace = await ctx.db.get('chatroom_workspaces', a.workspaceId);
  if (!workspace || !isWorkspaceForConfig(workspace, a)) {
    throw new Error('Workspace does not belong to this agent configuration');
  }
}

/** The room's active team structure, required for the launch request. */
async function requireTeamStructure(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_activeTeamStructures'>> {
  const activeStructure = await getActiveTeamStructure(ctx, chatroomId);
  if (!activeStructure) throw new Error(`Chatroom ${chatroomId} has no team structure`);
  return activeStructure;
}

/** A config may only point at a live workspace of the same room, machine and directory. */
function isWorkspaceForConfig(
  workspace: Doc<'chatroom_workspaces'>,
  a: SaveAgentConfigInput
): boolean {
  return (
    workspace.chatroomId === a.chatroomId &&
    workspace.removedAt === undefined &&
    workspace.machineId === a.machineId &&
    normalizeWorkingDir(workspace.workingDir) === normalizeWorkingDir(a.workingDir)
  );
}

/** The machine must exist and report the requested harness. */
async function assertHarnessAvailable(ctx: MutationCtx, a: SaveAgentConfigInput): Promise<void> {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', a.machineId))
    .first();
  if (!machine) throw new Error('Machine not found');

  const capabilities = await ctx.db
    .query('chatroom_machineCapabilities')
    .withIndex('by_machineId', (q) => q.eq('machineId', a.machineId))
    .first();
  if (!capabilities?.availableHarnesses?.includes(a.agentHarness)) {
    throw new Error(`Agent harness '${a.agentHarness}' is not available on this machine`);
  }
}
