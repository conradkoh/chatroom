import { describe, expect, it, vi } from 'vitest';

import { createAgentCommandService } from './agent-command-service.js';
import type { AgentCommandProcessManager } from './ports/agent-command-process-manager.js';
import type { AgentFactSink } from './ports/agent-fact-sink.js';
import type { AgentStopCommand } from '../domain/entities/agent-command.js';
import type { AgentStoppedFact } from '../domain/entities/agent-fact.js';
import { buildAgentStoppedEventId } from '../domain/entities/agent-fact.js';

function baseCommand(overrides?: Partial<AgentStopCommand>): AgentStopCommand {
  return {
    commandId: 'cmd-1',
    intentId: 'intent-1',
    machineId: 'machine-1',
    target: { kind: 'agent', chatroomId: 'room-1', role: 'planner' },
    reason: 'user.stop',
    createdAt: 1000,
    deadlineAt: 2000,
    ...overrides,
  };
}

function setup(deps?: {
  active?: { chatroomId: string; role: string; pid?: number }[];
  stopImpl?: AgentCommandProcessManager['stopAgent'];
  appendImpl?: (fact: AgentStoppedFact) => Promise<void>;
  now?: () => number;
}) {
  const stopAgent =
    deps?.stopImpl !== undefined
      ? vi.fn(deps.stopImpl)
      : vi.fn(async () => ({ success: true as const }));
  const processManager: AgentCommandProcessManager = {
    listActive: () => deps?.active ?? [],
    stopAgent,
  };
  const append = deps?.appendImpl !== undefined ? vi.fn(deps.appendImpl) : vi.fn(async () => {});
  const factSink: AgentFactSink = { append };
  const service = createAgentCommandService({
    processManager,
    factSink,
    now: deps?.now ?? (() => 1500),
  });
  return { service, processManager, factSink, stopAgent, append };
}

describe('agent-command-service', () => {
  it('expired command does not call process manager or sink', async () => {
    const { service, stopAgent, append } = setup({ now: () => 3000 });
    const result = await service.stop(baseCommand());
    expect(result).toEqual({
      commandId: 'cmd-1',
      status: 'expired',
      facts: [],
      failures: [],
    });
    expect(stopAgent).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('single active target stops and emits one fact with stable eventId, canonical role, pid, stopped outcome', async () => {
    const { service, stopAgent } = setup({
      active: [{ chatroomId: 'room-1', role: 'Planner', pid: 123 }],
    });
    const command = baseCommand({
      target: { kind: 'agent', chatroomId: 'room-1', role: '  PLANNER ' },
    });
    const result = await service.stop(command);

    expect(stopAgent).toHaveBeenCalledTimes(1);
    expect(stopAgent).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'Planner',
      reason: 'user.stop',
      pid: 123,
    });
    expect(result.status).toBe('completed');
    expect(result.failures).toEqual([]);
    expect(result.facts).toHaveLength(1);
    const fact = result.facts[0]!;
    expect(fact.kind).toBe('agent.stopped');
    expect(fact.role).toBe('Planner');
    expect(fact.pid).toBe(123);
    expect(fact.outcome).toBe('stopped');
    expect(fact.eventId).toBe(
      buildAgentStoppedEventId({
        commandId: 'cmd-1',
        chatroomId: 'room-1',
        role: 'Planner',
      })
    );
    expect(fact.eventId).toBe('agent.stopped:cmd-1:room-1:planner');
  });

  it('single target already absent emits already_stopped and does not call stopAgent', async () => {
    const { service, stopAgent, append } = setup({ active: [] });
    const result = await service.stop(baseCommand());

    expect(stopAgent).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    expect(result.failures).toEqual([]);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      kind: 'agent.stopped',
      outcome: 'already_stopped',
      role: 'planner',
      chatroomId: 'room-1',
    });
    expect(result.facts[0]!.pid).toBeUndefined();
    expect(result.facts[0]!.eventId).toBe('agent.stopped:cmd-1:room-1:planner');
  });

  it('chatroom target filters other chatrooms, sorts deterministically, stops sequentially, emits one fact per success', async () => {
    const callOrder: string[] = [];
    const { service, stopAgent, append } = setup({
      active: [
        { chatroomId: 'room-1', role: 'zeta', pid: 3 },
        { chatroomId: 'room-other', role: 'aaa', pid: 9 },
        { chatroomId: 'room-1', role: 'Alpha', pid: 1 },
        { chatroomId: 'room-1', role: 'mike', pid: 2 },
      ],
      stopImpl: async (input) => {
        callOrder.push(input.role);
        return { success: true };
      },
    });
    const command = baseCommand({
      target: { kind: 'chatroom', chatroomId: 'room-1' },
    });
    const result = await service.stop(command);

    expect(callOrder).toEqual(['Alpha', 'mike', 'zeta']);
    expect(stopAgent).toHaveBeenCalledTimes(3);
    expect(append).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('completed');
    expect(result.facts.map((fact) => fact.role)).toEqual(['Alpha', 'mike', 'zeta']);
  });

  it('empty local chatroom is a successful no-op with no facts', async () => {
    const { service, stopAgent, append } = setup({ active: [] });
    const result = await service.stop(
      baseCommand({ target: { kind: 'chatroom', chatroomId: 'room-1' } })
    );
    expect(stopAgent).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(result).toEqual({
      commandId: 'cmd-1',
      status: 'completed',
      facts: [],
      failures: [],
    });
  });

  it('chatroom targets emit already_stopped for agents that disappeared after request creation', async () => {
    const { service, stopAgent, append } = setup({ active: [] });
    const result = await service.stop(
      baseCommand({
        target: { kind: 'chatroom', chatroomId: 'room-1' },
        targets: [{ role: 'builder', pid: 42 }],
      })
    );

    expect(stopAgent).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(1);
    expect(result.facts[0]).toMatchObject({ role: 'builder', outcome: 'already_stopped' });
  });

  it('one target failure continues to next target and returns partial_failure with one failure', async () => {
    const { service } = setup({
      active: [
        { chatroomId: 'room-1', role: 'alpha', pid: 1 },
        { chatroomId: 'room-1', role: 'beta', pid: 2 },
      ],
      stopImpl: async (input) =>
        input.role === 'alpha' ? { success: false, error: 'boom' } : { success: true },
    });
    const result = await service.stop(
      baseCommand({ target: { kind: 'chatroom', chatroomId: 'room-1' } })
    );
    expect(result.status).toBe('partial_failure');
    expect(result.failures).toEqual([{ chatroomId: 'room-1', role: 'alpha', error: 'boom' }]);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.role).toBe('beta');
  });

  it('fact sink rejection rejects the command', async () => {
    const { service } = setup({
      active: [{ chatroomId: 'room-1', role: 'planner', pid: 1 }],
      appendImpl: async () => {
        throw new Error('sink failed');
      },
    });
    await expect(service.stop(baseCommand())).rejects.toThrow('sink failed');
  });

  it('same command/target produces same eventId on repeated service calls', async () => {
    const first = setup({
      active: [{ chatroomId: 'room-1', role: 'Planner', pid: 1 }],
    });
    const second = setup({
      active: [],
    });
    const command = baseCommand();
    const firstResult = await first.service.stop(command);
    const secondResult = await second.service.stop(command);
    expect(firstResult.facts[0]!.eventId).toBe(secondResult.facts[0]!.eventId);
    expect(firstResult.facts[0]!.outcome).toBe('stopped');
    expect(secondResult.facts[0]!.outcome).toBe('already_stopped');
  });

  it('exercises the complete service boundary: command -> fake process manager -> fact sink with exact fact', async () => {
    const stored: AgentStoppedFact[] = [];
    const now = () => 1500;
    const processManager: AgentCommandProcessManager = {
      listActive: () => [{ chatroomId: 'room-1', role: 'builder', pid: 4242 }],
      stopAgent: async (input) => {
        expect(input).toEqual({
          chatroomId: 'room-1',
          role: 'builder',
          reason: 'user.stop',
          pid: 4242,
        });
        return { success: true };
      },
    };
    const factSink: AgentFactSink = {
      append: async (fact) => {
        stored.push(fact);
      },
    };
    const service = createAgentCommandService({ processManager, factSink, now });
    const command = baseCommand({
      commandId: 'cmd-boundary',
      intentId: 'intent-boundary',
      machineId: 'machine-boundary',
      target: { kind: 'agent', chatroomId: 'room-1', role: 'builder' },
    });

    const result = await service.stop(command);

    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({
      kind: 'agent.stopped',
      eventId: 'agent.stopped:cmd-boundary:room-1:builder',
      intentId: 'intent-boundary',
      commandId: 'cmd-boundary',
      machineId: 'machine-boundary',
      chatroomId: 'room-1',
      role: 'builder',
      pid: 4242,
      outcome: 'stopped',
      reason: 'user.stop',
      occurredAt: 1500,
    });
    expect(result.facts[0]).toEqual(stored[0]);
    expect(result.status).toBe('completed');
    expect(result.failures).toEqual([]);
  });
});
