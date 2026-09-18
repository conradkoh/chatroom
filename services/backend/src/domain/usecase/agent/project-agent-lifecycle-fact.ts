import { agentExited as agentExitedUseCase } from './agent-exited';
import { applyAgentActivityHeartbeat } from './apply-agent-activity-heartbeat';
import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { registerSpawnedAgentIfAuthorized } from './register-spawned-agent';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { onAgentExited } from '../../../events/agent/on-agent-exited';

export type AgentLifecycleFactInput =
  | {
      kind: 'activity';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      action: string;
      taskId?: Id<'chatroom_tasks'> | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'spawned';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      pid: number;
      model?: string | undefined;
      reason?: string | undefined;
      harnessSessionId?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'exited';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      pid: number;
      stopReason?: string | undefined;
      stopSignal?: string | undefined;
      exitCode?: number | undefined;
      signal?: string | undefined;
      agentHarness?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'turn_failed';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      taskId?: Id<'chatroom_tasks'> | undefined;
      harnessSessionId?: string | undefined;
      turnId: string;
      status: string;
      source: string;
      error?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'status';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      status: 'offline' | 'starting' | 'waiting' | 'working' | 'stopping' | 'error';
      errorSource?: 'configuration' | 'runtime' | 'task' | 'stop' | undefined;
      errorCode?: string | undefined;
      errorMessage?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'chatroom_shutdown_complete';
      chatroomId: Id<'chatroom_rooms'>;
      commandId: Id<'chatroom_machineCommandInbox'>;
      finalizeChatroom?: boolean | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | { kind: 'cleared_all_pids'; revisionKey: string; emittedAt: number };

export async function projectAgentLifecycleFact(
  ctx: MutationCtx,
  args: { machineId: string; fact: AgentLifecycleFactInput }
): Promise<{
  success: true;
  skipped?: boolean | undefined;
  clearedCount?: number | undefined;
  reconciledExecutionCount?: number | undefined;
  rejectionReason?: string | undefined;
}> {
  const { machineId, fact } = args;
  if (fact.kind === 'activity') {
    await applyAgentActivityHeartbeat(ctx, { ...fact, machineId });
    return { success: true };
  }
  if (fact.kind === 'cleared_all_pids') {
    const rows = await ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .collect();
    let clearedCount = 0;
    for (const row of rows) {
      if (row.observedPid !== undefined) clearedCount++;
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId: row.chatroomId,
        workspaceId: row.workspaceId,
        role: row.role,
        event: { status: 'offline' },
        sourceMachineId: machineId,
        sourceEventAt: fact.emittedAt,
        sourceRevisionKey: fact.revisionKey,
        clearObservedPid: true,
        observedAt: fact.emittedAt,
      });
    }
    return { success: true, clearedCount };
  }
  if (fact.kind === 'exited') {
    const result = await agentExitedUseCase(ctx, {
      ...fact,
      machineId,
      revisionKey: fact.revisionKey,
      emittedAt: fact.emittedAt,
    });
    if (result.applied) await onAgentExited(ctx, fact);
    return { success: true, skipped: !result.applied };
  }
  if (fact.kind === 'turn_failed') {
    const launchRequest = await getLastSentLaunchRequestForRole(ctx, {
      chatroomId: fact.chatroomId,
      role: fact.role,
    });
    if (!launchRequest || launchRequest.machineId !== machineId)
      return { success: true, skipped: true, rejectionReason: 'not_configured' };
    await transitionAgentStatus(
      ctx,
      fact.chatroomId,
      fact.role,
      'agent.turnFailed',
      undefined,
      {
        status: 'error',
        errorSource: 'runtime',
        errorCode: fact.status,
        errorMessage: `${fact.source}${fact.error ? `: ${fact.error}` : ''}`,
      },
      { machineId, emittedAt: fact.emittedAt, revisionKey: fact.revisionKey }
    );
    return { success: true };
  }
  if (fact.kind === 'status') {
    const launchRequest = await getLastSentLaunchRequestForRole(ctx, {
      chatroomId: fact.chatroomId,
      role: fact.role,
    });
    if (!launchRequest || launchRequest.machineId !== machineId)
      return { success: true, skipped: true, rejectionReason: 'not_configured' };
    await projectAgentRoleStatusReadModel(ctx, {
      chatroomId: fact.chatroomId,
      role: fact.role,
      event: {
        status: fact.status,
        ...(fact.errorSource
          ? {
              errorSource: fact.errorSource,
              errorCode: fact.errorCode ?? 'daemon.status',
              errorMessage: fact.errorMessage,
            }
          : {}),
      },
      launchRequest,
      agentType: launchRequest.agentType,
      sourceMachineId: machineId,
      sourceEventAt: fact.emittedAt,
      sourceRevisionKey: fact.revisionKey,
    });
    return { success: true };
  }
  if (fact.kind === 'chatroom_shutdown_complete') {
    const command = await ctx.db.get('chatroom_machineCommandInbox', fact.commandId);
    if (!command || command.machineId !== machineId) {
      return { success: true, skipped: true, rejectionReason: 'command_not_found' };
    }
    if (command.status !== 'processing') {
      return { success: true, skipped: true, rejectionReason: 'command_not_processing' };
    }
    await ctx.db.delete('chatroom_machineCommandInbox', command._id);
    return {
      success: true,
    };
  }
  const registration = await registerSpawnedAgentIfAuthorized(ctx, {
    ...fact,
    machineId,
  });
  if (!registration.accepted)
    return { success: true, skipped: true, rejectionReason: registration.reason };
  return { success: true };
}
