import { describe, expect, it, vi } from 'vitest';

import {
  createAgentProcessManagerService,
  type AgentProcessManagerExecutionPort,
} from './agent-process-manager-service.js';
import type {
  EnsureRunningOpts,
  StopOpts,
} from '../../../../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';

function createExecution(events: string[]): AgentProcessManagerExecutionPort {
  return {
    ensureRunning: vi.fn(async (input) => {
      events.push(`start:${input.chatroomId}:${input.role}`);
      return { success: true };
    }),
    stop: vi.fn(async (input) => {
      events.push(`stop:${input.chatroomId}:${input.role}`);
      return { success: true };
    }),
    handleExit: vi.fn(async () => undefined),
    recover: vi.fn(async () => undefined),
    getSlot: vi.fn(() => undefined),
    listActive: vi.fn(() => []),
    clearStuckStoppingSlot: vi.fn(async () => false),
    whenTurnEndsIdle: vi.fn(async () => undefined),
    resumeTurnForSlot: vi.fn(async () => undefined),
    setLastInFlightTask: vi.fn(),
    clearLastInFlightTaskIfMatches: vi.fn(),
    reconcileNativeTurnPhaseIdle: vi.fn(),
  };
}

const startInput = (chatroomId: string, role: string) =>
  ({
    chatroomId,
    role,
    agentHarness: 'claude',
    workingDir: '/tmp/workspace',
    reason: 'test',
    wantResume: false,
  }) as unknown as EnsureRunningOpts;

const stopInput = (chatroomId: string, role: string) =>
  ({ chatroomId, role, reason: 'user.stop' }) as StopOpts;

async function waitForEventCount(events: string[], count: number): Promise<void> {
  await vi.waitFor(() => expect(events).toHaveLength(count), { timeout: 1_000 });
}

describe('AgentProcessManagerService', () => {
  it('serializes lifecycle commands for the same agent key', async () => {
    const events: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      restartAgent: vi.fn(async () => undefined),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    service.startProcessing();
    await service.startAgent(startInput('room-1', 'builder'));
    await service.stopAgent(stopInput('room-1', 'builder'));
    await waitForEventCount(events, 2);
    service.stopProcessing();

    expect(events).toEqual(['start:room-1:builder', 'stop:room-1:builder']);
  });

  it('allows commands for different agent keys to be processed independently', async () => {
    const events: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      restartAgent: vi.fn(async () => undefined),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    service.startProcessing();
    await Promise.all([
      service.startAgent(startInput('room-1', 'builder')),
      service.startAgent(startInput('room-2', 'builder')),
    ]);
    await waitForEventCount(events, 2);
    service.stopProcessing();

    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining(['start:room-1:builder', 'start:room-2:builder'])
    );
  });
});
