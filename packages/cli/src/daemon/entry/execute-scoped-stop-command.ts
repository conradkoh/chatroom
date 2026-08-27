import type { AgentStopScope } from '@workspace/shared/domain/agent-stop-command';

import { api } from '../../api.js';
import { abortEnhancerSpawnsForChatroom } from './enhancer/enhancer-spawn-registry.js';
import type { AgentStopReason } from '../domain/entities/agent-stop.js';
import type { AgentProcessManager } from '../infrastructure/agent-process-manager/agent-process-manager.js';
import type { runExactTargetsStop as runExactTargetsStopType } from '../infrastructure/agent-process-manager/execute-stop-targets-adapter.js';

export interface ScopedStopExecutionSummary {
  stoppedCount: number;
  failedCount: number;
  executionError?: unknown;
}

export async function executeScopedStopForCommand(args: {
  sessionId: string;
  machineId: string;
  backend: { mutation: (fn: unknown, input: unknown) => Promise<unknown> };
  apm: AgentProcessManager;
  stopCommandId: string;
  chatroomId: string;
  scope: AgentStopScope;
  reason: AgentStopReason;
  inboxCommandId: string;
}): Promise<ScopedStopExecutionSummary> {
  if (args.scope.kind === 'chatroom') {
    await abortEnhancerSpawnsForChatroom(args.chatroomId);
  }
  const { runExactTargetsStop } =
    await import('../infrastructure/agent-process-manager/execute-stop-targets-adapter.js');
  const finalize = await import('./finalize-scoped-stop-execution.js');
  const begun = (await args.backend.mutation(api.agentStops.beginMachineExecution, {
    sessionId: args.sessionId,
    stopCommandId: args.stopCommandId,
    machineId: args.machineId,
    inboxCommandId: args.inboxCommandId,
  })) as { shouldExecute: boolean; targets: { targetKey: string; role: string; pid: number }[] };
  if (!begun.shouldExecute) return { stoppedCount: 0, failedCount: 0 };
  for (const target of begun.targets) {
    args.apm.bindStopTarget?.({
      chatroomId: args.chatroomId,
      role: target.role,
      pid: target.pid,
      stopCommandId: args.stopCommandId,
      targetKey: target.targetKey,
    });
  }
  let result: Awaited<ReturnType<typeof runExactTargetsStopType>> = { targets: [], failures: [] };
  let executionError: unknown;
  try {
    result = await runExactTargetsStop({
      apm: args.apm,
      confirmedDeps: args.apm.getConfirmedStopAdapterDeps(),
      stopCommandId: args.stopCommandId,
      chatroomId: args.chatroomId,
      targets: begun.targets as Parameters<typeof runExactTargetsStopType>[0]['targets'],
      reason: args.reason,
    });
  } catch (error) {
    executionError = error;
    console.warn('[daemon] scoped stop execution failed', error);
  } finally {
    await finalize.finalizeScopedStopExecution({ ...args, result, executionError });
    await args.apm.syncSlotsAfterScopedStop(result);
  }
  return {
    stoppedCount: result.targets.length,
    failedCount: result.failures.length + (executionError != null ? 1 : 0),
    executionError,
  };
}
