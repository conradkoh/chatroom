import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_COMMAND_INBOX_DEFAULT_LEASE_RENEWAL_MS,
  startAgentCommandInboxConsumer,
} from './agent-command-inbox-consumer.js';
import type { AgentCommandInbox } from './ports/agent-command-inbox.js';
import type {
  AgentStopCommand,
  AgentStopCommandResult,
  AgentStopCommandStatus,
} from '../domain/entities/agent-command.js';

const makeCommand = (id: string): AgentStopCommand => ({
  commandId: id,
  intentId: `intent-${id}`,
  machineId: 'machine-1',
  target: { kind: 'agent', chatroomId: 'room-1', role: 'builder' },
  reason: 'user.stop',
  createdAt: 1000,
  deadlineAt: 2000,
});

const makeResult = (commandId: string, status: AgentStopCommandStatus): AgentStopCommandResult => ({
  commandId,
  status,
  facts: [],
  failures: [],
});

interface FakeInboxState {
  readonly pending: AgentStopCommand[];
  readonly acknowledged: string[];
  readonly renewed: string[];
  claimCalls: number;
  unsubscribeCalls: number;
  failClaimTimes: number;
  failRenew: boolean;
  readonly failAcknowledge: Set<string>;
  onAvailable: (() => void) | null;
}

function createFakeInbox() {
  const state: FakeInboxState = {
    pending: [],
    acknowledged: [],
    renewed: [],
    claimCalls: 0,
    unsubscribeCalls: 0,
    failClaimTimes: 0,
    failRenew: false,
    failAcknowledge: new Set<string>(),
    onAvailable: null,
  };
  const inbox: AgentCommandInbox = {
    claimNext: async () => {
      state.claimCalls++;
      if (state.failClaimTimes > 0) {
        state.failClaimTimes--;
        throw new Error('claim failed');
      }
      return state.pending.shift() ?? null;
    },
    acknowledge: async (commandId) => {
      if (state.failAcknowledge.has(commandId)) throw new Error(`ack failed for ${commandId}`);
      state.acknowledged.push(commandId);
    },
    renew: async (commandId) => {
      state.renewed.push(commandId);
      if (state.failRenew) throw new Error('renew failed');
    },
    subscribe: (onAvailable, _onError) => {
      state.onAvailable = onAvailable;
      return () => {
        state.unsubscribeCalls++;
        state.onAvailable = null;
      };
    },
  };
  return { state, inbox };
}

interface FakeServiceState {
  readonly calls: string[];
  active: number;
  maxActive: number;
  defaultStatus: AgentStopCommandStatus;
  readonly statuses: Map<string, AgentStopCommandStatus>;
  readonly failures: Set<string>;
  readonly gates: Map<string, { promise: Promise<void>; release: () => void }>;
}

function createFakeService() {
  const state: FakeServiceState = {
    calls: [],
    active: 0,
    maxActive: 0,
    defaultStatus: 'completed',
    statuses: new Map<string, AgentStopCommandStatus>(),
    failures: new Set<string>(),
    gates: new Map<string, { promise: Promise<void>; release: () => void }>(),
  };
  const service = {
    stop: async (command: AgentStopCommand): Promise<AgentStopCommandResult> => {
      state.calls.push(command.commandId);
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        const gate = state.gates.get(command.commandId);
        if (gate) await gate.promise;
        if (state.failures.has(command.commandId)) {
          throw new Error(`service failed for ${command.commandId}`);
        }
        return makeResult(
          command.commandId,
          state.statuses.get(command.commandId) ?? state.defaultStatus
        );
      } finally {
        state.active--;
      }
    },
  };
  const gateCommand = (commandId: string): (() => void) => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.gates.set(commandId, { promise, release });
    return () => {
      state.gates.delete(commandId);
      release();
    };
  };
  return { state, service, gateCommand };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async (rounds = 20): Promise<void> => {
  for (let i = 0; i < rounds; i++) await flush();
};

describe('agent command inbox consumer', () => {
  it('initial drain claims and processes an available command', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { state: service, service: servicePort } = createFakeService();
    const errors: unknown[] = [];
    inbox.pending.push(makeCommand('cmd-1'));

    const consumer = startAgentCommandInboxConsumer({
      inbox: inboxPort,
      service: servicePort,
      onError: (error) => errors.push(error),
    });
    await settle();
    await consumer.stop();

    expect(service.calls).toEqual(['cmd-1']);
    expect(inbox.acknowledged).toEqual(['cmd-1']);
    expect(errors).toEqual([]);
  });

  it('acknowledges completed results', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { service: servicePort } = createFakeService();
    inbox.pending.push(makeCommand('cmd-completed'));

    const consumer = startAgentCommandInboxConsumer({ inbox: inboxPort, service: servicePort });
    await settle();
    await consumer.stop();

    expect(inbox.acknowledged).toEqual(['cmd-completed']);
  });

  it('acknowledges expired results', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { state: service, service: servicePort } = createFakeService();
    service.statuses.set('cmd-expired', 'expired');
    inbox.pending.push(makeCommand('cmd-expired'));

    const consumer = startAgentCommandInboxConsumer({ inbox: inboxPort, service: servicePort });
    await settle();
    await consumer.stop();

    expect(inbox.acknowledged).toEqual(['cmd-expired']);
  });

  it('does not acknowledge partial_failure and reports an error', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { state: service, service: servicePort } = createFakeService();
    const errors: unknown[] = [];
    service.statuses.set('cmd-partial', 'partial_failure');
    inbox.pending.push(makeCommand('cmd-partial'));

    const consumer = startAgentCommandInboxConsumer({
      inbox: inboxPort,
      service: servicePort,
      onError: (error) => errors.push(error),
    });
    await settle();
    await consumer.stop();

    expect(inbox.acknowledged).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('cmd-partial');
  });

  it('does not acknowledge when the service throws and reports an error', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { state: service, service: servicePort } = createFakeService();
    const errors: unknown[] = [];
    service.failures.add('cmd-boom');
    inbox.pending.push(makeCommand('cmd-boom'));

    const consumer = startAgentCommandInboxConsumer({
      inbox: inboxPort,
      service: servicePort,
      onError: (error) => errors.push(error),
    });
    await settle();
    await consumer.stop();

    expect(inbox.acknowledged).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('cmd-boom');
  });

  it('reports an acknowledge throw without crashing', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { service: servicePort } = createFakeService();
    const errors: unknown[] = [];
    inbox.failAcknowledge.add('cmd-ack-fail');
    inbox.pending.push(makeCommand('cmd-ack-fail'));

    const consumer = startAgentCommandInboxConsumer({
      inbox: inboxPort,
      service: servicePort,
      onError: (error) => errors.push(error),
    });
    await settle();
    await consumer.stop();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('cmd-ack-fail');
    expect(inbox.acknowledged).toEqual([]);
  });

  it('renews the lease while service processing is blocked', async () => {
    vi.useFakeTimers();
    try {
      const { state: inbox, inbox: inboxPort } = createFakeInbox();
      const { service: servicePort, gateCommand } = createFakeService();
      const release = gateCommand('cmd-slow');
      inbox.pending.push(makeCommand('cmd-slow'));

      const consumer = startAgentCommandInboxConsumer({
        inbox: inboxPort,
        service: servicePort,
        leaseRenewalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2500);

      expect(inbox.renewed).toEqual(['cmd-slow', 'cmd-slow']);
      expect(inbox.acknowledged).toEqual([]);

      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(inbox.acknowledged).toEqual(['cmd-slow']);
      await consumer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports renewal failure without crashing the consumer', async () => {
    vi.useFakeTimers();
    try {
      const { state: inbox, inbox: inboxPort } = createFakeInbox();
      const { service: servicePort, gateCommand } = createFakeService();
      const errors: unknown[] = [];
      inbox.failRenew = true;
      const release = gateCommand('cmd-renew-fail');
      inbox.pending.push(makeCommand('cmd-renew-fail'));

      const consumer = startAgentCommandInboxConsumer({
        inbox: inboxPort,
        service: servicePort,
        onError: (error) => errors.push(error),
        leaseRenewalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);

      expect(errors.length).toBeGreaterThan(0);
      expect(String(errors[0])).toContain('renew failed');

      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(inbox.acknowledged).toEqual(['cmd-renew-fail']);
      await consumer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('processes commands serially, never concurrently', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { state: service, service: servicePort, gateCommand } = createFakeService();
    const releaseFirst = gateCommand('cmd-first');
    inbox.pending.push(makeCommand('cmd-first'), makeCommand('cmd-second'));

    const consumer = startAgentCommandInboxConsumer({ inbox: inboxPort, service: servicePort });
    await settle();

    // First command is blocked; the second must not have started.
    expect(service.calls).toEqual(['cmd-first']);
    expect(service.maxActive).toBe(1);

    releaseFirst();
    await settle();
    await consumer.stop();

    expect(service.calls).toEqual(['cmd-first', 'cmd-second']);
    expect(service.maxActive).toBe(1);
    expect(inbox.acknowledged).toEqual(['cmd-first', 'cmd-second']);
  });

  it('queues another drain when a nudge arrives during processing', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { service: servicePort, gateCommand } = createFakeService();
    const releaseFirst = gateCommand('cmd-a');
    inbox.pending.push(makeCommand('cmd-a'));

    const consumer = startAgentCommandInboxConsumer({ inbox: inboxPort, service: servicePort });
    await settle();

    inbox.pending.push(makeCommand('cmd-b'));
    inbox.onAvailable?.();
    await settle();

    releaseFirst();
    await settle();
    await consumer.stop();

    expect(inbox.acknowledged).toEqual(['cmd-a', 'cmd-b']);
  });

  it('reports inbox claim failure without a tight synchronous loop', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { service: servicePort } = createFakeService();
    const errors: unknown[] = [];
    inbox.failClaimTimes = 1;

    const consumer = startAgentCommandInboxConsumer({
      inbox: inboxPort,
      service: servicePort,
      onError: (error) => errors.push(error),
    });
    await settle();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('claim failed');
    expect(inbox.claimCalls).toBe(1);

    // The consumer recovers on the next nudge.
    inbox.pending.push(makeCommand('cmd-after-claim-error'));
    inbox.onAvailable?.();
    await settle();
    await consumer.stop();

    expect(inbox.acknowledged).toEqual(['cmd-after-claim-error']);
  });

  it('stop unsubscribes exactly once and prevents future claims', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { service: servicePort, gateCommand } = createFakeService();
    const release = gateCommand('cmd-inflight');
    inbox.pending.push(makeCommand('cmd-inflight'));

    const consumer = startAgentCommandInboxConsumer({ inbox: inboxPort, service: servicePort });
    await settle();
    const claimsBeforeStop = inbox.claimCalls;

    await consumer.stop();
    await consumer.stop();
    expect(inbox.unsubscribeCalls).toBe(1);

    // In-flight work finishes, but no further claims happen after stop.
    release();
    await settle();
    expect(inbox.claimCalls).toBe(claimsBeforeStop);

    inbox.pending.push(makeCommand('cmd-after-stop'));
    inbox.onAvailable?.();
    await settle();
    expect(inbox.claimCalls).toBe(claimsBeforeStop);
    expect(inbox.acknowledged).toEqual(['cmd-inflight']);
  });

  it('throws synchronously for invalid leaseRenewalMs values', () => {
    const { inbox: inboxPort } = createFakeInbox();
    const { service: servicePort } = createFakeService();
    for (const leaseRenewalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        startAgentCommandInboxConsumer({ inbox: inboxPort, service: servicePort, leaseRenewalMs })
      ).toThrow('leaseRenewalMs');
    }
    expect(AGENT_COMMAND_INBOX_DEFAULT_LEASE_RENEWAL_MS).toBe(20_000);
  });

  it('nudge -> claim -> service.stop -> acknowledge passes the exact command id', async () => {
    const { state: inbox, inbox: inboxPort } = createFakeInbox();
    const { state: service, service: servicePort } = createFakeService();
    const acknowledge = vi.fn(inboxPort.acknowledge);
    const inboxWithSpy: AgentCommandInbox = { ...inboxPort, acknowledge };

    const consumer = startAgentCommandInboxConsumer({ inbox: inboxWithSpy, service: servicePort });
    await settle();
    expect(service.calls).toEqual([]);

    const command = makeCommand('cmd-exact-1');
    inbox.pending.push(command);
    inbox.onAvailable?.();
    await settle();
    await consumer.stop();

    expect(service.calls).toEqual(['cmd-exact-1']);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith('cmd-exact-1');
    expect(inbox.acknowledged).toEqual(['cmd-exact-1']);
  });
});
