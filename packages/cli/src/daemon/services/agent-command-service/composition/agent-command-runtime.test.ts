import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { startDaemonAgentCommandRuntime } from './agent-command-runtime.js';
import type { AgentProcessManagerService } from '../../agent-process-service/index.js';
import type { AgentStopCommand } from '../domain/entities/agent-command.js';
import type { AgentStoppedFact } from '../domain/entities/agent-fact.js';
import type { AgentCommandInbox } from '../service/ports/agent-command-inbox.js';

const makeCommand = (id: string): AgentStopCommand => ({
  commandId: id,
  intentId: `intent-${id}`,
  machineId: 'machine-1',
  target: { kind: 'agent', chatroomId: 'room-1', role: 'builder' },
  reason: 'user.stop',
  createdAt: 1000,
  deadlineAt: 2000,
});

function createFakeInbox() {
  const pending: AgentStopCommand[] = [];
  const acknowledged: string[] = [];
  return { pending, acknowledged };
}

function createFakeProcessManager() {
  const stopCalls: { chatroomId: string; role: string; reason: string; pid?: number }[] = [];
  const processManager = {
    listActive: () => [
      { chatroomId: 'room-1', role: 'builder', slot: { state: 'running' as const, pid: 99 } },
    ],
    stopAgent: async (input: {
      chatroomId: string;
      role: string;
      reason: string;
      pid?: number;
    }) => {
      stopCalls.push({ ...input });
      return {
        eventId: 'event-1',
        operationId: 'operation-1',
        messageId: 'message-1',
        messageGroupId: 'group-1',
        body: { operationId: 'operation-1', type: 'stop', input },
        status: 'succeeded' as const,
        completedAt: 1500,
        receiveCount: 1,
      };
    },
  };
  return {
    stopCalls,
    processManager: processManager as unknown as AgentProcessManagerService,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async (rounds = 20): Promise<void> => {
  for (let i = 0; i < rounds; i++) await flush();
};

describe('daemon agent command runtime composition', () => {
  it('nudge -> claim -> process manager stop -> fact sink append -> acknowledge', async () => {
    const inbox = createFakeInbox();
    const { stopCalls, processManager } = createFakeProcessManager();
    const facts: AgentStoppedFact[] = [];
    const errors: unknown[] = [];
    const acknowledge = vi.fn(async (commandId: string) => {
      inbox.acknowledged.push(commandId);
    });
    let unsubscribed = 0;
    const nudgeHolder: { current: (() => void) | null } = { current: null };
    const inboxWithHooks: AgentCommandInbox = {
      claimNext: async () => inbox.pending.shift() ?? null,
      acknowledge,
      renew: async () => {},
      subscribe: (available) => {
        nudgeHolder.current = available;
        return () => {
          unsubscribed++;
        };
      },
    };

    const runtime = startDaemonAgentCommandRuntime({
      inbox: inboxWithHooks,
      processManager,
      factSink: {
        append: async (fact) => {
          facts.push(fact);
        },
      },
      onError: (error) => errors.push(error),
      now: () => 1500,
    });
    await settle();

    inbox.pending.push(makeCommand('cmd-runtime-1'));
    nudgeHolder.current?.();
    await settle();

    expect(stopCalls).toEqual([
      { chatroomId: 'room-1', role: 'builder', reason: 'user.stop', pid: 99 },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: 'agent.stopped',
      commandId: 'cmd-runtime-1',
      chatroomId: 'room-1',
      role: 'builder',
      pid: 99,
      outcome: 'stopped',
      occurredAt: 1500,
    });
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith('cmd-runtime-1');
    expect(inbox.acknowledged).toEqual(['cmd-runtime-1']);
    expect(errors).toEqual([]);

    await runtime.stop();
    expect(unsubscribed).toBe(1);
  });

  it('does not import Convex or backend code', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const file of ['agent-command-service.ts', 'agent-command-runtime.ts']) {
      const source = readFileSync(join(dir, file), 'utf8');
      const importStatements = source
        .split('\n')
        .filter((line) => /^\s*import[^\n]*\bfrom\b/.test(line));
      for (const statement of importStatements) {
        expect(statement).not.toMatch(/convex/i);
        expect(statement).not.toMatch(/@workspace\/backend/);
      }
      expect(importStatements.length).toBeGreaterThan(0);
    }
  });
});
