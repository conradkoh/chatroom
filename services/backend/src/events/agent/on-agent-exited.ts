import type { Id } from '../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../convex/_generated/server';
import { internal } from '../../../convex/_generated/api';
import { getTeamEntryPoint } from '../../domain/entities/team';
import { buildTeamRoleKey } from '../../../convex/utils/teamRoleKey';

export interface OnAgentExitedArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  intentional: boolean;
  stopReason?: string;
}

/**
 * Handles the `agent.exited` event (backend side).
 *
 * When an agent exits (crash, signal, or clean completion), schedules an
 * immediate ensure-agent check for any active task assigned to that role —
 * bypassing the normal staleness guard so crash recovery fires without
 * waiting for the next scheduled timer interval.
 *
 * Intentional stops (user-initiated via UI) are excluded from restart.
 * The `desiredState` guard provides a second layer of protection against
 * unwanted restarts.
 */
export async function onAgentExited(ctx: MutationCtx, args: OnAgentExitedArgs): Promise<void> {
  const { chatroomId, role, intentional, stopReason } = args;

  // Determine if this exit warrants crash recovery
  // When stopReason is available, restart on clean exits and unexpected crashes.
  // Also restart on signal-terminated processes — this covers the case where the
  // daemon kills an idle agent after its turn ends (agent_end in RPC mode).
  // The desiredState guard below prevents restart when the user explicitly stops.
  const shouldRestart = stopReason
    ? stopReason !== 'user.stop' && stopReason !== 'platform.team_switch'
    : !intentional;

  if (!shouldRestart) {
    return;
  }

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);

  // Belt-and-suspenders: check desiredState before scheduling restart
  // This prevents restart if the user has explicitly stopped the agent
  // (even if stopReason suggests restart is appropriate — e.g. Race 2)
  let teamConfig = null;
  if (chatroom?.teamId) {
    const exitTeamRoleKey = buildTeamRoleKey(chatroomId, chatroom.teamId, role);
    teamConfig = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', exitTeamRoleKey))
      .first();
  }

  if (teamConfig?.desiredState === 'stopped') {
    return; // User intent respected — no restart
  }

  if (teamConfig && teamConfig.type !== 'remote') {
    return; // Only remote agents get crash recovery
  }

  const entryPoint = getTeamEntryPoint(chatroom ?? {});
  const normalizedRole = role.toLowerCase();

  const activeTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .filter((q) =>
      q.or(
        q.eq(q.field('status'), 'pending'),
        q.eq(q.field('status'), 'acknowledged'),
        q.eq(q.field('status'), 'in_progress')
      )
    )
    .collect();

  const relevantTask = activeTasks.find((task) => {
    const assignedRole = task.assignedTo?.toLowerCase();
    if (assignedRole) return assignedRole === normalizedRole;
    return normalizedRole === entryPoint?.toLowerCase();
  });

  if (relevantTask) {
    await ctx.scheduler.runAfter(0, internal.ensureAgentHandler.check, {
      taskId: relevantTask._id,
      chatroomId,
      snapshotUpdatedAt: 0, // bypass staleness guard — crash recovery
    });
  }
}
