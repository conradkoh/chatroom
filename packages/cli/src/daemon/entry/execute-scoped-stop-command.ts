import type { AgentStopScope } from '@workspace/shared/domain/agent-stop-command';

import { api } from '../../api.js';
import type { AgentStopReason } from '../domain/entities/agent-stop.js';
import type { AgentProcessManager } from '../infrastructure/agent-process-manager/agent-process-manager.js';

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
}): Promise<void> {
  const { runExactTargetsStop } =
    await import('../infrastructure/agent-process-manager/stop-agent-scope-adapter.js');
  const finalize = await import('./finalize-scoped-stop-execution.js');
  const begun = (await args.backend.mutation(api.agentStops.beginMachineExecution, {
    sessionId: args.sessionId,
    stopCommandId: args.stopCommandId as any,
    machineId: args.machineId,
    inboxCommandId: args.inboxCommandId as any,
  })) as { shouldExecute: boolean; targets: any[] };
  if (!begun.shouldExecute) return;
  let result: any = { targets: [], failures: [] };
  let executionError: unknown;
  try {
    result = await runExactTargetsStop({
      apm: args.apm,
      confirmedDeps: args.apm.getConfirmedStopAdapterDeps(),
      stopCommandId: args.stopCommandId,
      chatroomId: args.chatroomId,
      targets: begun.targets,
      reason: args.reason,
    });
  } catch (error) {
    executionError = error;
    console.warn('[daemon] scoped stop execution failed', error);
  } finally {
    await finalize.finalizeScopedStopExecution({ ...args, result, executionError });
    await args.apm.syncSlotsAfterScopedStop(result);
  }
}
