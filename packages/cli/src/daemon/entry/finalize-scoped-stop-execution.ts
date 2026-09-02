import { api } from '../../api.js';

export async function finalizeScopedStopExecution(args: {
  sessionId: string;
  machineId: string;
  stopCommandId: string;
  chatroomId: string;
  backend: { mutation: (fn: unknown, input: unknown) => Promise<unknown> };
  result: {
    targets: {
      target: { targetKey: string; role: string; pid: number };
      outcome: { kind: string; termination?: string | undefined };
      lifecycleWarning?: string | undefined;
    }[];
    failures: { target: { targetKey: string; role: string; pid: number }; error: unknown }[];
  };
  executionError?: unknown | undefined;
}): Promise<void> {
  for (const { target, outcome, lifecycleWarning } of args.result.targets) {
    await args.backend.mutation(api.agentStops.reportTargetOutcome, {
      sessionId: args.sessionId,
      stopCommandId: args.stopCommandId,
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      targetKey: target.targetKey,
      role: target.role,
      pid: target.pid,
      status: 'completed',
      outcome: outcome.kind === 'stopped' ? 'stopped' : 'already_stopped',
      termination: outcome.termination,
      lifecycleWarning,
    });
  }
  for (const failure of args.result.failures) {
    await args.backend.mutation(api.agentStops.reportTargetOutcome, {
      sessionId: args.sessionId,
      stopCommandId: args.stopCommandId,
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      targetKey: failure.target.targetKey,
      role: failure.target.role,
      pid: failure.target.pid,
      status: 'failed',
      outcome: 'failed',
      errorMessage: String(failure.error),
    });
  }
  const failed = args.result.failures.length > 0 || args.executionError != null;
  await args.backend.mutation(api.agentStops.completeMachineExecution, {
    sessionId: args.sessionId,
    stopCommandId: args.stopCommandId,
    machineId: args.machineId,
    status: failed ? 'failed' : 'completed',
    errorMessage: failed
      ? args.executionError
        ? String(args.executionError)
        : `${args.result.failures.length} target(s) failed`
      : undefined,
  });
}
