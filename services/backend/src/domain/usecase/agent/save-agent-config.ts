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
// fallow-ignore-next-line complexity
export async function saveAgentConfig(
  ctx: MutationCtx,
  a: SaveAgentConfigInput
): Promise<Doc<'chatroom_agentLastSentLaunchRequests'>> {
  validateWorkingDir(a.workingDir);
  if (!a.model.trim()) throw new Error('Agent model is required');

  const workspace = await ctx.db.get('chatroom_workspaces', a.workspaceId);
  if (
    !workspace ||
    workspace.chatroomId !== a.chatroomId ||
    workspace.removedAt !== undefined ||
    workspace.machineId !== a.machineId ||
    normalizeWorkingDir(workspace.workingDir) !== normalizeWorkingDir(a.workingDir)
  ) {
    throw new Error('Workspace does not belong to this agent configuration');
  }

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

  const activeStructure = await getActiveTeamStructure(ctx, a.chatroomId);
  if (!activeStructure) throw new Error(`Chatroom ${a.chatroomId} has no team structure`);

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
