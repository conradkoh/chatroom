import type { AgentStopScope } from '@workspace/shared/domain/agent-stop-command';
import { AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';

import { api } from '../../api.js';
import { abortEnhancerSpawnsForChatroom } from './enhancer/enhancer-spawn-registry.js';
import type { AgentStopReason } from '../domain/entities/agent-stop.js';
import type { AgentProcessManager } from '../services/agent-process-service/index.js';
import type { runExactTargetsStop as runExactTargetsStopType } from '../services/agent-process-service/index.js';
import type { AgentProcessManagerService } from '../services/agent-process-service/index.js';

export interface ScopedStopExecutionSummary {
  stoppedCount: number;
  failedCount: number;
  executionError?: unknown | undefined;
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
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
}): Promise<ScopedStopExecutionSummary> {
  // Claim daemon-local stop intent before any backend/network await. This
  // invalidates already-running task activation immediately.
  args.apm.markChatroomStopIntent(args.chatroomId, args.reason);
  if (args.scope.kind === 'chatroom') {
    await abortEnhancerSpawnsForChatroom(args.chatroomId);
  }
  const { runExactTargetsStop } =
    await import('../services/agent-process-service/index.js');
  const finalize = await import('./finalize-scoped-stop-execution.js');
  const begun = (await args.backend.mutation(api.agentStops.beginMachineExecution, {
    sessionId: args.sessionId,
    stopCommandId: args.stopCommandId,
    machineId: args.machineId,
    inboxCommandId: args.inboxCommandId,
  })) as { shouldExecute: boolean; targets: { targetKey: string; role: string; pid: number }[] };
  if (!begun.shouldExecute) return { stoppedCount: 0, failedCount: 0 };
  for (const target of begun.targets) {
    args.apm.markStopIntent(args.chatroomId, target.role, args.reason, target.pid);
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
    const targetsByRole = new Map<string, typeof begun.targets>();
    for (const target of begun.targets) {
      const roleTargets = targetsByRole.get(target.role) ?? [];
      roleTargets.push(target);
      targetsByRole.set(target.role, roleTargets);
    }
    const roleResults = await Promise.all(
      [...targetsByRole.entries()].map(([role, targets]) =>
        args.runSerializedForAgent(
          { chatroomId: args.chatroomId, role },
          { timeoutMs: AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS },
          async (_ops, context) => {
            if (context.signal.aborted) throw context.signal.reason;
            return runExactTargetsStop({
              apm: args.apm,
              confirmedDeps: args.apm.getConfirmedStopAdapterDeps(),
              stopCommandId: args.stopCommandId,
              chatroomId: args.chatroomId,
              targets: targets as Parameters<typeof runExactTargetsStopType>[0]['targets'],
              reason: args.reason,
            });
          }
        )
      )
    );
    result = {
      targets: roleResults.flatMap((roleResult) => roleResult.targets),
      failures: roleResults.flatMap((roleResult) => roleResult.failures),
    };
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
