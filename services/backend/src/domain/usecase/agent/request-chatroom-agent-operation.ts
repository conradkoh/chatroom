import { getPermanentRoleNames, isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { requestAgentRestart } from './request-agent-restart';
import { requestChatroomWorkspaceAgentStop } from './request-chatroom-workspace-agent-stop';
import { startAgentFromCurrentWorkspaceConfig } from './start-agent-from-current-config';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getTeamStructure } from '../../entities/team-presets';
import { isActiveWorkspace } from '../../entities/workspace';
import { getActiveTeamStructure } from '../team/active-team-structure';

export type ChatroomAgentOperation = 'start' | 'stop' | 'restart';

export interface ChatroomAgentOperationResult {
  operation: ChatroomAgentOperation;
  requested: { role?: string; workspaceId?: Id<'chatroom_workspaces'>; machineId?: string }[];
  skipped: { role?: string; workspaceId?: Id<'chatroom_workspaces'>; reason: string }[];
  failed: { role?: string; workspaceId?: Id<'chatroom_workspaces'>; error: string }[];
  commandIds: Id<'chatroom_machineCommandInbox'>[];
}

// fallow-ignore-next-line complexity
export async function requestChatroomAgentOperation(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    operation: ChatroomAgentOperation;
    requestedBy: Id<'users'>;
    finalizeChatroom?: boolean;
  }
): Promise<ChatroomAgentOperationResult> {
  if (input.operation === 'stop') {
    const stopped = await requestChatroomWorkspaceAgentStop(ctx, input);
    return {
      operation: input.operation,
      requested: stopped.commands.map(({ machineId, workingDir }) => ({ machineId, workingDir })),
      skipped: [],
      failed: [],
      commandIds: stopped.commandIds,
    };
  }

  const room = await ctx.db.get('chatroom_rooms', input.chatroomId);
  const activeTeam = await getActiveTeamStructure(ctx, input.chatroomId);
  if (!room || !activeTeam) {
    return { operation: input.operation, requested: [], skipped: [], failed: [], commandIds: [] };
  }
  const team = getTeamStructure({
    teamId: activeTeam.teamStructureId,
    persistedRoles: room.teamRoles ?? null,
    persistedEntryPoint: room.teamEntryPoint ?? null,
  });
  const roles = getPermanentRoleNames(
    team.roles
      .map(({ role }) => role)
      .filter((role) => !isEphemeralAgentRole(role) && role !== 'user')
  );
  const workspaces = (
    await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
      .collect()
  ).filter((workspace) => isActiveWorkspace(workspace.removedAt));

  const result: ChatroomAgentOperationResult = {
    operation: input.operation,
    requested: [],
    skipped: [],
    failed: [],
    commandIds: [],
  };
  await Promise.all(
    workspaces.flatMap((workspace) =>
      roles.map(async (role) => {
        const context = { role, workspaceId: workspace._id };
        try {
          const launch = await getLastSentLaunchRequestForRole(ctx, {
            chatroomId: input.chatroomId,
            role,
            workspaceId: workspace._id,
          });
          if (!launch) {
            result.skipped.push({ ...context, reason: 'No saved launch configuration' });
            return;
          }
          if (!launch.agentHarness || !launch.model?.trim() || !launch.workingDir?.trim()) {
            result.skipped.push({ ...context, reason: 'Saved launch configuration is incomplete' });
            return;
          }
          if (input.operation === 'start') {
            const started = await startAgentFromCurrentWorkspaceConfig(ctx, {
              chatroomId: input.chatroomId,
              workspaceId: workspace._id,
              role,
              requestedBy: input.requestedBy,
            });
            if (started.status === 'started') {
              result.requested.push({ ...context, machineId: started.machineId });
            } else {
              result.skipped.push({ ...context, reason: started.reason });
            }
            return;
          }
          const machine = await ctx.db
            .query('chatroom_machines')
            .withIndex('by_machineId', (q) => q.eq('machineId', launch.machineId))
            .first();
          if (!machine || machine.userId !== input.requestedBy) {
            result.skipped.push({
              ...context,
              reason: 'Saved machine is not available to the requester',
            });
            return;
          }
          const restarted = await requestAgentRestart(
            ctx,
            {
              chatroomId: input.chatroomId,
              workspaceId: workspace._id,
              role,
              requestedBy: input.requestedBy,
              request: {
                reason: 'user.restart',
                overrides: {
                  machineId: launch.machineId,
                  model: launch.model ?? '',
                  agentHarness: launch.agentHarness,
                  workingDir: launch.workingDir,
                },
              },
            },
            machine
          );
          if (restarted.status === 'requested') {
            result.requested.push({ ...context, machineId: launch.machineId });
          } else {
            result.skipped.push({ ...context, reason: restarted.reason });
          }
        } catch (error) {
          result.failed.push({
            ...context,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    )
  );
  return result;
}
