import { applySuccessfulTargetLifecycle } from './apply-successful-target-lifecycle';
import { rollupAgentStopCommandStatus } from './rollup-agent-stop-command';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentStopReason } from '../../entities/agent';
import { normalizeAgentStopRole } from '../../entities/agent-stop-command';

export interface ApplyAgentStoppedFactInput {
  machineId: string;
  fact: {
    eventId: string;
    intentId: string;
    commandId: string;
    machineId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    pid?: number | undefined;
    outcome: 'stopped' | 'already_stopped';
    reason: AgentStopReason;
    occurredAt: number;
  };
}

export type ApplyAgentStoppedFactResult = { success: true; applied: boolean };
export type AgentStoppedFactInput = ApplyAgentStoppedFactInput['fact'];

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'superseded';
}

async function loadStopCommand(
  ctx: MutationCtx,
  intentId: string
): Promise<Doc<'chatroom_agentStopCommands'> | null> {
  try {
    return await ctx.db.get(
      'chatroom_agentStopCommands',
      intentId as Id<'chatroom_agentStopCommands'>
    );
  } catch {
    return null;
  }
}

async function loadMachineExecution(
  ctx: MutationCtx,
  stopCommandId: Id<'chatroom_agentStopCommands'>,
  machineId: string
) {
  return ctx.db
    .query('chatroom_agentStopMachineExecutions')
    .withIndex('by_stopCommandId_machineId', (q) =>
      q.eq('stopCommandId', stopCommandId).eq('machineId', machineId)
    )
    .unique();
}

async function listMachineTargets(
  ctx: MutationCtx,
  stopCommandId: Id<'chatroom_agentStopCommands'>,
  machineId: string
) {
  return ctx.db
    .query('chatroom_agentStopTargets')
    .withIndex('by_stopCommandId_machineId', (q) =>
      q.eq('stopCommandId', stopCommandId).eq('machineId', machineId)
    )
    .collect();
}

function matchTarget(
  targets: Doc<'chatroom_agentStopTargets'>[],
  role: string,
  pid: number | undefined
): Doc<'chatroom_agentStopTargets'> | undefined {
  const normalizedRole = normalizeAgentStopRole(role);
  return targets.find(
    (target) =>
      normalizeAgentStopRole(target.role) === normalizedRole &&
      (pid === undefined || target.pid === pid)
  );
}

async function completeMatchedTarget(
  ctx: MutationCtx,
  command: Doc<'chatroom_agentStopCommands'>,
  target: Doc<'chatroom_agentStopTargets'>,
  fact: AgentStoppedFactInput
): Promise<void> {
  await ctx.db.patch('chatroom_agentStopTargets', target._id, {
    status: 'completed',
    outcome: fact.outcome,
    ...(fact.outcome === 'already_stopped' ? { termination: 'absent' as const } : {}),
    completedAt: fact.occurredAt,
  });
  const updatedTarget = await ctx.db.get('chatroom_agentStopTargets', target._id);
  if (updatedTarget) await applySuccessfulTargetLifecycle(ctx, { command, target: updatedTarget });
}

// fallow-ignore-next-line complexity
async function completeExecutionWhenTargetsTerminal(
  ctx: MutationCtx,
  stopCommandId: Id<'chatroom_agentStopCommands'>,
  machineId: string,
  executionId: Id<'chatroom_agentStopMachineExecutions'>
): Promise<void> {
  const refreshedTargets = await listMachineTargets(ctx, stopCommandId, machineId);
  if (refreshedTargets.length === 0) return;
  if (!refreshedTargets.every((target) => isTerminalStatus(target.status))) return;
  const latestExecution = await ctx.db.get('chatroom_agentStopMachineExecutions', executionId);
  if (!latestExecution || isTerminalStatus(latestExecution.status)) return;
  await ctx.db.patch('chatroom_agentStopMachineExecutions', executionId, {
    status: 'completed',
    completedAt: Date.now(),
  });
}

/**
 * Apply one daemon `AgentStoppedFact` idempotently to existing stop projections.
 *
 * Stable backend correlation is `intentId` (the stop-command id). The dedicated
 * inbox transport id (`commandId`) is never used for lookup and inbox rows are
 * never deleted here — acknowledgement stays with the inbox transport.
 */
// fallow-ignore-next-line complexity
export async function applyAgentStoppedFact(
  ctx: MutationCtx,
  input: ApplyAgentStoppedFactInput
): Promise<ApplyAgentStoppedFactResult> {
  const { fact } = input;
  const noOp = { success: true as const, applied: false };

  const command = await loadStopCommand(ctx, fact.intentId);
  if (!command) return noOp;
  if (command.chatroomId !== fact.chatroomId) return noOp;
  if (fact.machineId !== input.machineId) return noOp;

  const execution = await loadMachineExecution(ctx, command._id, input.machineId);
  if (!execution || isTerminalStatus(execution.status)) return noOp;

  const matched = matchTarget(
    await listMachineTargets(ctx, command._id, input.machineId),
    fact.role,
    fact.pid
  );
  if (!matched || isTerminalStatus(matched.status)) return noOp;

  await completeMatchedTarget(ctx, command, matched, fact);
  await completeExecutionWhenTargetsTerminal(ctx, command._id, input.machineId, execution._id);
  await rollupAgentStopCommandStatus(ctx, command._id);
  return { success: true, applied: true };
}
