import { describe, expect, it, vi } from 'vitest';

import { createDaemonAgentCommandService } from './agent-command-service.js';
import type { AgentProcessManagerService } from '../../agent-process-service/index.js';
import type { AgentStopCommand } from '../domain/entities/agent-command.js';
import type { AgentStoppedFact } from '../domain/entities/agent-fact.js';

type StopStatus = 'succeeded' | 'failed' | 'cancelled';

interface FakeProcessManagerState {
  active: { chatroomId: string; role: string; pid?: number }[];
  readonly stopCalls: { chatroomId: string; role: string; reason: string; pid?: number }[];
  stopStatus: StopStatus;
  stopError: unknown;
}

function createFakeProcessManager() {
  const state: FakeProcessManagerState = {
    active: [],
    stopCalls: [],
    stopStatus: 'succeeded',
    stopError: undefined,
  };
  const processManager = {
    listActive: () =>
      state.active.map((entry) => ({
        chatroomId: entry.chatroomId,
        role: entry.role,
        slot:
          entry.pid === undefined
            ? { state: 'running' as const }
            : { state: 'running' as const, pid: entry.pid },
      })),
    stopAgent: async (input: {
      chatroomId: string;
      role: string;
      reason: string;
      pid?: number;
    }) => {
      state.stopCalls.push({ ...input });
      return {
        eventId: 'event-1',
        operationId: 'operation-1',
        messageId: 'message-1',
        messageGroupId: 'group-1',
        body: { operationId: 'operation-1', type: 'stop', input },
        status: state.stopStatus,
        completedAt: 1500,
        receiveCount: 1,
        ...(state.stopError === undefined ? {} : { error: state.stopError }),
      };
    },
  };
  return {
    state,
    processManager: processManager as unknown as AgentProcessManagerService,
  };
}

function createFakeFactSink() {
  const facts: AgentStoppedFact[] = [];
  return {
    facts,
    append: vi.fn(async (fact: AgentStoppedFact) => {
      facts.push(fact);
    }),
  };
}

const makeCommand = (overrides?: Partial<AgentStopCommand>): AgentStopCommand => ({
  commandId: 'cmd-1',
  intentId: 'intent-1',
  machineId: 'machine-1',
  target: { kind: 'agent', chatroomId: 'room-1', role: 'builder' },
  reason: 'user.stop',
  createdAt: 1000,
  // Far-future deadline: these tests use the real clock unless now is injected.
  deadlineAt: 4_000_000_000_000,
  ...overrides,
});

describe('daemon agent command service composition', () => {
  it('maps listActive chatroomId, role, and PID and omits undefined PID', async () => {
    const { state, processManager } = createFakeProcessManager();
    const sink = createFakeFactSink();
    state.active = [
      { chatroomId: 'room-1', role: 'Builder', pid: 7 },
      { chatroomId: 'room-1', role: 'planner' },
    ];
    const service = createDaemonAgentCommandService({ processManager, factSink: sink });

    const result = await service.stop(
      makeCommand({ target: { kind: 'chatroom', chatroomId: 'room-1' } })
    );

    expect(result.status).toBe('completed');
    expect(state.stopCalls).toEqual([
      { chatroomId: 'room-1', role: 'Builder', reason: 'user.stop', pid: 7 },
      { chatroomId: 'room-1', role: 'planner', reason: 'user.stop' },
    ]);
    expect(sink.facts.map((fact) => ({ role: fact.role, pid: fact.pid }))).toEqual([
      { role: 'Builder', pid: 7 },
      { role: 'planner', pid: undefined },
    ]);
  });

  it('maps a successful stop to success true and emits a fact through the sink', async () => {
    const { state, processManager } = createFakeProcessManager();
    const sink = createFakeFactSink();
    state.active = [{ chatroomId: 'room-1', role: 'builder', pid: 99 }];
    const service = createDaemonAgentCommandService({ processManager, factSink: sink });

    const result = await service.stop(makeCommand());

    expect(result.status).toBe('completed');
    expect(result.failures).toEqual([]);
    expect(sink.facts).toHaveLength(1);
    expect(sink.facts[0]).toMatchObject({
      kind: 'agent.stopped',
      commandId: 'cmd-1',
      chatroomId: 'room-1',
      role: 'builder',
      pid: 99,
      outcome: 'stopped',
    });
  });

  it('maps failed results to success false with the error message', async () => {
    const { state, processManager } = createFakeProcessManager();
    const sink = createFakeFactSink();
    state.active = [{ chatroomId: 'room-1', role: 'builder', pid: 99 }];
    state.stopStatus = 'failed';
    state.stopError = new Error('boom');
    const service = createDaemonAgentCommandService({ processManager, factSink: sink });

    const result = await service.stop(makeCommand());

    expect(result.status).toBe('partial_failure');
    expect(result.failures).toEqual([{ chatroomId: 'room-1', role: 'builder', error: 'boom' }]);
    expect(sink.facts).toEqual([]);
  });

  it('maps cancelled results with no error to a useful default message', async () => {
    const { state, processManager } = createFakeProcessManager();
    const sink = createFakeFactSink();
    state.active = [{ chatroomId: 'room-1', role: 'builder' }];
    state.stopStatus = 'cancelled';
    const service = createDaemonAgentCommandService({ processManager, factSink: sink });

    const result = await service.stop(makeCommand());

    expect(result.status).toBe('partial_failure');
    expect(result.failures).toEqual([
      { chatroomId: 'room-1', role: 'builder', error: 'agent stop cancelled' },
    ]);
  });

  it('maps non-Error results with String() conversion', async () => {
    const { state, processManager } = createFakeProcessManager();
    const sink = createFakeFactSink();
    state.active = [{ chatroomId: 'room-1', role: 'builder' }];
    state.stopStatus = 'failed';
    state.stopError = 'plain failure';
    const service = createDaemonAgentCommandService({ processManager, factSink: sink });

    const result = await service.stop(makeCommand());

    expect(result.failures).toEqual([
      { chatroomId: 'room-1', role: 'builder', error: 'plain failure' },
    ]);
  });

  it('passes requested pid, reason, chatroom, and role unchanged to the process manager', async () => {
    const { state, processManager } = createFakeProcessManager();
    const sink = createFakeFactSink();
    state.active = [{ chatroomId: 'room-1', role: 'builder', pid: 4242 }];
    const service = createDaemonAgentCommandService({ processManager, factSink: sink });

    await service.stop(makeCommand({ reason: 'daemon.shutdown' }));

    expect(state.stopCalls).toEqual([
      { chatroomId: 'room-1', role: 'builder', reason: 'daemon.shutdown', pid: 4242 },
    ]);
  });

  it('uses the injected now for fact occurredAt', async () => {
    const { state, processManager } = createFakeProcessManager();
    const sink = createFakeFactSink();
    state.active = [{ chatroomId: 'room-1', role: 'builder', pid: 1 }];
    const service = createDaemonAgentCommandService({
      processManager,
      factSink: sink,
      now: () => 4242,
    });

    await service.stop(makeCommand());

    expect(sink.facts[0]?.occurredAt).toBe(4242);
  });
});
