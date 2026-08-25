// fallow-ignore-file unused-file unused-export unused-type complexity
import type {
  AgentStopOutcome,
  AgentStopTargetDescriptor,
  AgentStopReason,
} from '../entities/agent-stop.js';
import { AgentStopError } from '../entities/agent-stop.js';

export interface HarnessStopPort {
  stop(target: AgentStopTargetDescriptor, opts: { preserveForResume: boolean }): Promise<void>;
}
export interface ProcessLivenessPort {
  isAlive(pid: number): boolean;
}
export interface LifecycleDeliveryPort {
  awaitExitedFact(args: {
    target: AgentStopTargetDescriptor;
    reason: AgentStopReason;
    revisionKey: string;
    outcome: AgentStopOutcome;
  }): Promise<void>;
}
export interface StopAgentConfirmedDeps {
  harnessStop: HarnessStopPort;
  liveness: ProcessLivenessPort;
  lifecycle: LifecycleDeliveryPort;
  forceKill?: { forceKill(target: AgentStopTargetDescriptor): Promise<void> };
}
export async function stopAgentConfirmed(
  deps: StopAgentConfirmedDeps,
  args: {
    target: AgentStopTargetDescriptor;
    reason: AgentStopReason;
    revisionKey: string;
    preserveForResume?: boolean;
    timeoutMs?: number;
  }
): Promise<AgentStopOutcome> {
  const { target, reason, revisionKey } = args;
  if (!target.agentHarness)
    throw new AgentStopError('harness_missing', `No harness recorded for ${target.role}`);
  if (!deps.liveness.isAlive(target.pid)) {
    const outcome: AgentStopOutcome = {
      kind: 'already_stopped',
      pid: target.pid,
      termination: 'absent',
    };
    try {
      await deps.lifecycle.awaitExitedFact({ target, reason, revisionKey, outcome });
    } catch (cause) {
      throw new AgentStopError(
        'lifecycle_delivery_failed',
        `Failed to deliver exited fact for ${target.role}`,
        cause
      );
    }
    return outcome;
  }
  try {
    if (args.timeoutMs && deps.forceKill) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([deps.harnessStop.stop(target, { preserveForResume: args.preserveForResume ?? false }), new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new AgentStopError('stop_timed_out', `Timed out stopping ${target.role}`)), args.timeoutMs); })]).finally(() => { if (timer) clearTimeout(timer); }).catch(async (cause) => {
        if (!(cause instanceof AgentStopError) || cause.code !== 'stop_timed_out') throw cause;
        await deps.forceKill!.forceKill(target);
      });
    } else await deps.harnessStop.stop(target, { preserveForResume: args.preserveForResume ?? false });
  } catch (cause) {
    throw new AgentStopError(
      'harness_stop_failed',
      `Harness stop failed for ${target.role} pid=${target.pid}`,
      cause
    );
  }
  if (deps.liveness.isAlive(target.pid))
    throw new AgentStopError(
      'still_alive',
      `Process still alive after harness stop for ${target.role} pid=${target.pid}`
    );
  const outcome: AgentStopOutcome = { kind: 'stopped', pid: target.pid, termination: 'graceful' };
  try {
    await deps.lifecycle.awaitExitedFact({ target, reason, revisionKey, outcome });
  } catch (cause) {
    throw new AgentStopError(
      'lifecycle_delivery_failed',
      `Failed to deliver exited fact for ${target.role}`,
      cause
    );
  }
  return outcome;
}
