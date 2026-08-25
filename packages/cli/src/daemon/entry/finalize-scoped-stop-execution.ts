import { api } from '../../api.js';

export async function finalizeScopedStopExecution(args: { sessionId: string; machineId: string; stopCommandId: string; chatroomId: string; backend: { mutation: (fn: unknown, input: unknown) => Promise<unknown> }; result: { targets: Array<{ target: { targetKey: string; role: string; pid: number }; outcome: { kind: string } }>; failures: Array<{ target: { targetKey: string; role: string; pid: number }; error: unknown }> } }): Promise<void> {
  const reported = new Set<string>();
  for (const { target, outcome } of args.result.targets) {
    reported.add(target.targetKey);
    await args.backend.mutation(api.agentStops.reportTargetOutcome, { sessionId: args.sessionId, stopCommandId: args.stopCommandId as any, chatroomId: args.chatroomId as any, machineId: args.machineId, targetKey: target.targetKey, role: target.role, pid: target.pid, status: 'completed', outcome: outcome.kind === 'stopped' ? 'stopped' : 'already_stopped' });
  }
  for (const failure of args.result.failures) {
    reported.add(failure.target.targetKey);
    await args.backend.mutation(api.agentStops.reportTargetOutcome, { sessionId: args.sessionId, stopCommandId: args.stopCommandId as any, chatroomId: args.chatroomId as any, machineId: args.machineId, targetKey: failure.target.targetKey, role: failure.target.role, pid: failure.target.pid, status: 'failed', outcome: 'failed', errorMessage: String(failure.error) });
  }
  await args.backend.mutation(api.agentStops.reconcileMachineStopTargets, { sessionId: args.sessionId, stopCommandId: args.stopCommandId as any, machineId: args.machineId, reportedTargetKeys: [...reported] });
  await args.backend.mutation(api.agentStops.completeMachineExecution, { sessionId: args.sessionId, stopCommandId: args.stopCommandId as any, machineId: args.machineId, status: args.result.failures.length ? 'failed' : 'completed', errorMessage: args.result.failures.length ? `${args.result.failures.length} target(s) failed` : undefined });
}
