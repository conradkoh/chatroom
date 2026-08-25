import { api } from '../../api.js';
import type { AgentStopScope } from '../../../../../services/backend/src/domain/entities/agent-stop-command.js';
import type { AgentStopReason } from '../domain/entities/agent-stop.js';
import type { AgentProcessManager } from '../infrastructure/agent-process-manager/agent-process-manager.js';

export async function executeScopedStopForCommand(args: {
  sessionId: string; machineId: string; backend: { mutation: (fn: unknown, input: unknown) => Promise<unknown> };
  apm: AgentProcessManager; stopCommandId: string; chatroomId: string; scope: AgentStopScope;
  reason: AgentStopReason; inboxCommandId: string;
}): Promise<void> {
  await args.backend.mutation(api.agentStops.beginMachineExecution, { sessionId: args.sessionId, stopCommandId: args.stopCommandId as any, machineId: args.machineId, inboxCommandId: args.inboxCommandId as any });
  const { runScopedStopFromInbox } = await import('../infrastructure/agent-process-manager/stop-agent-scope-adapter.js');
  const result = await runScopedStopFromInbox({ apm: args.apm, confirmedDeps: args.apm.getConfirmedStopAdapterDeps(), stopCommandId: args.stopCommandId, chatroomId: args.chatroomId, scope: args.scope, reason: args.reason });
  for (const { target, outcome } of result.targets) {
    const mapped = outcome.kind === 'stopped' ? { status: 'completed' as const, outcome: 'stopped' as const } : { status: 'completed' as const, outcome: 'already_stopped' as const };
    await args.backend.mutation(api.agentStops.reportTargetOutcome, { sessionId: args.sessionId, stopCommandId: args.stopCommandId as any, chatroomId: args.chatroomId as any, machineId: args.machineId, targetKey: target.targetKey, role: target.role, pid: target.pid, ...mapped });
  }
  for (const failure of result.failures) await args.backend.mutation(api.agentStops.reportTargetOutcome, { sessionId: args.sessionId, stopCommandId: args.stopCommandId as any, chatroomId: args.chatroomId as any, machineId: args.machineId, targetKey: failure.target.targetKey, role: failure.target.role, pid: failure.target.pid, status: 'failed', outcome: 'failed', errorMessage: String(failure.error) });
  await args.backend.mutation(api.agentStops.completeMachineExecution, { sessionId: args.sessionId, stopCommandId: args.stopCommandId as any, machineId: args.machineId, status: result.failures.length ? 'failed' : 'completed', errorMessage: result.failures.length ? `${result.failures.length} target(s) failed` : undefined });
}
