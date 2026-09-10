// fallow-ignore-file unused-file
// Temporary: Convex inbox adapter and daemon startup composition land in later slices.
import type { AgentCommandService } from './agent-command-service.js';
import type { AgentCommandInbox } from './ports/agent-command-inbox.js';
import type { AgentStopCommand } from '../domain/entities/agent-command.js';

export const AGENT_COMMAND_INBOX_DEFAULT_LEASE_RENEWAL_MS = 20_000;

export interface AgentCommandInboxConsumerDependencies {
  readonly inbox: AgentCommandInbox;
  readonly service: Pick<AgentCommandService, 'stop'>;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly leaseRenewalMs?: number | undefined;
}

export interface AgentCommandInboxConsumer {
  stop(): Promise<void>;
}

interface AgentCommandInboxRuntime {
  readonly inbox: AgentCommandInbox;
  readonly service: Pick<AgentCommandService, 'stop'>;
  readonly leaseRenewalMs: number;
  readonly reportError: (error: unknown) => void;
}

interface AgentCommandDrainState {
  stopped: boolean;
  draining: boolean;
  queued: boolean;
}

function resolveLeaseRenewalMs(configured: number | undefined): number {
  const leaseRenewalMs = configured ?? AGENT_COMMAND_INBOX_DEFAULT_LEASE_RENEWAL_MS;
  if (!Number.isFinite(leaseRenewalMs) || leaseRenewalMs <= 0) {
    throw new Error(
      `Invalid leaseRenewalMs ${String(configured)}: must be a finite number greater than 0`
    );
  }
  return leaseRenewalMs;
}

function startLeaseRenewal(
  runtime: AgentCommandInboxRuntime,
  command: AgentStopCommand
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    runtime.inbox.renew(command.commandId).catch(runtime.reportError);
  }, runtime.leaseRenewalMs);
  timer.unref?.();
  return timer;
}

async function settleCommand(
  runtime: AgentCommandInboxRuntime,
  command: AgentStopCommand
): Promise<void> {
  const result = await runtime.service.stop(command);
  if (result.status === 'partial_failure') {
    runtime.reportError(
      new Error(
        `Agent stop command ${command.commandId} partially failed; leaving leased for retry`
      )
    );
    return;
  }
  try {
    await runtime.inbox.acknowledge(command.commandId);
  } catch (error) {
    runtime.reportError(error);
  }
}

async function processCommand(
  runtime: AgentCommandInboxRuntime,
  command: AgentStopCommand
): Promise<void> {
  const timer = startLeaseRenewal(runtime, command);
  try {
    await settleCommand(runtime, command);
  } catch (error) {
    runtime.reportError(error);
  } finally {
    clearInterval(timer);
  }
}

async function drainOnce(
  runtime: AgentCommandInboxRuntime,
  state: AgentCommandDrainState
): Promise<void> {
  // Check stopped before every claim so no claim follows a stop request.
  while (!state.stopped) {
    const command = await runtime.inbox.claimNext();
    if (command === null) return;
    await processCommand(runtime, command);
  }
}

function beginDrain(state: AgentCommandDrainState): boolean {
  if (state.stopped) return false;
  if (state.draining) {
    state.queued = true;
    return false;
  }
  state.draining = true;
  return true;
}

async function drainPass(
  runtime: AgentCommandInboxRuntime,
  state: AgentCommandDrainState
): Promise<void> {
  state.queued = false;
  try {
    await drainOnce(runtime, state);
  } catch (error) {
    // Claim errors end this drain; the next availability nudge retries.
    // Never spin in a tight retry loop here.
    runtime.reportError(error);
  }
}

async function drain(
  runtime: AgentCommandInboxRuntime,
  state: AgentCommandDrainState
): Promise<void> {
  if (!beginDrain(state)) return;
  try {
    do {
      await drainPass(runtime, state);
    } while (state.queued && !state.stopped);
  } finally {
    state.draining = false;
  }
}

export function startAgentCommandInboxConsumer(
  deps: AgentCommandInboxConsumerDependencies
): AgentCommandInboxConsumer {
  const leaseRenewalMs = resolveLeaseRenewalMs(deps.leaseRenewalMs);
  const reportError = (error: unknown): void => {
    deps.onError?.(error);
  };
  const runtime: AgentCommandInboxRuntime = {
    inbox: deps.inbox,
    service: deps.service,
    leaseRenewalMs,
    reportError,
  };
  const state: AgentCommandDrainState = { stopped: false, draining: false, queued: false };
  let activeDrain: Promise<void> | undefined;
  const requestDrain = (): void => {
    if (state.stopped) return;
    const promise = drain(runtime, state);
    if (state.draining) {
      activeDrain ??= promise;
      void promise.catch(reportError).finally(() => {
        if (activeDrain === promise) activeDrain = undefined;
      });
    } else {
      void promise.catch(reportError);
    }
  };
  // Subscribe before the initial drain so an availability nudge cannot be lost.
  const unsubscribe = deps.inbox.subscribe(requestDrain, reportError);
  requestDrain();
  let unsubscribed = false;
  return {
    stop: async () => {
      state.stopped = true;
      if (!unsubscribed) {
        unsubscribed = true;
        unsubscribe();
      }
      await activeDrain;
    },
  };
}
