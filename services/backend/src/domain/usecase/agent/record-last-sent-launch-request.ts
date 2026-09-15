import { writeWorkspaceAgentConfigInboxEvent } from './write-workspace-agent-config-inbox-event';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType } from '../../entities/agent';

export interface LastSentLaunchRequestInput {
  requestId: string;
  commandId: string;
  chatroomId: Id<'chatroom_rooms'>;
  teamStructureId: string;
  role: string;
  agentType: AgentType;
  machineId: string;
  workspaceId?: Id<'chatroom_workspaces'> | undefined;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  wantResume: boolean;
  requestedBy: Id<'users'>;
  requestedAt: number;
}

/**
 * Records the latest complete launch request sent by the webapp for a role.
 * This is a request snapshot, not a desired-state record: the daemon remains
 * authoritative for whether the request was accepted or what is running.
 */
export async function recordLastSentLaunchRequest(
  ctx: MutationCtx,
  input: LastSentLaunchRequestInput
): Promise<Doc<'chatroom_agentLastSentLaunchRequests'>> {
  const saved = await upsertLastSentLaunchRequest(ctx, input);

  // Agent config sync: every save/start/restart of a remote agent publishes the
  // config to the machine's inbox so the daemon can resolve it independently
  // of any running process.
  if (input.agentType === 'remote') {
    await writeWorkspaceAgentConfigInboxEvent(ctx, {
      machineId: input.machineId,
      chatroomId: input.chatroomId,
      role: input.role,
      agentHarness: input.agentHarness,
      model: input.model,
      workingDir: input.workingDir,
    });
  }

  return saved;
}

async function upsertLastSentLaunchRequest(
  ctx: MutationCtx,
  input: LastSentLaunchRequestInput
): Promise<Doc<'chatroom_agentLastSentLaunchRequests'>> {
  const existing = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_requestKey', (q) => q.eq('requestKey', launchRequestKey(input)))
    .first();

  const fields = launchRequestFields(input);

  const id = existing
    ? (await ctx.db.patch('chatroom_agentLastSentLaunchRequests', existing._id, fields),
      existing._id)
    : await ctx.db.insert('chatroom_agentLastSentLaunchRequests', fields);

  const updated = await ctx.db.get('chatroom_agentLastSentLaunchRequests', id);
  if (!updated) throw new Error('Failed to persist last-sent launch request');
  return updated;
}

function launchRequestKey(input: LastSentLaunchRequestInput): string {
  // Workspace-scoped snapshots are independently reusable for the same role.
  // Keep the legacy key for non-workspace callers until those callers migrate.
  const role = input.role.trim().toLowerCase();
  return input.workspaceId
    ? `${input.chatroomId}:${input.teamStructureId}:${input.workspaceId}:${role}`
    : `${input.chatroomId}:${input.teamStructureId}:${role}`;
}

function launchRequestFields(input: LastSentLaunchRequestInput) {
  return {
    requestKey: launchRequestKey(input),
    requestId: input.requestId,
    commandId: input.commandId,
    chatroomId: input.chatroomId,
    teamStructureId: input.teamStructureId,
    role: input.role,
    agentType: input.agentType,
    machineId: input.machineId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    agentHarness: input.agentHarness,
    model: input.model,
    workingDir: input.workingDir,
    reason: input.reason,
    wantResume: input.wantResume,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
  };
}
