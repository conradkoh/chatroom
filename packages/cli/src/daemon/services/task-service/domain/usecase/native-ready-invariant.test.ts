import { describe, expect, it } from 'vitest';

import { explainAgentReadyForNativeDeliveryBlock } from './native-ready-invariant.js';

const task = (overrides: Record<string, unknown> = {}) =>
  ({
    taskId: 'task-1',
    chatroomId: 'room-1',
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 1,
    createdAt: 1,
    agentConfig: {
      role: 'builder',
      machineId: 'machine-1',
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp',
      spawnedAgentPid: 42,
      desiredState: 'stopped',
    },
    participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
    ...overrides,
  }) as never;

const idleSlot = (overrides: Record<string, unknown> = {}) =>
  ({
    state: 'running',
    pid: 99,
    harnessSessionId: 'harness-1',
    nativeTurnPhase: 'idle',
    ...overrides,
  }) as never;

describe('native-ready-invariant', () => {
  it('allows delivery-owned cold spawn when slot is down', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(task({ requestsNativeColdSession: true }), undefined)
    ).toBeNull();
  });

  it('still blocks when the locally running slot has a turn in flight', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(
        task({
          agentConfig: {
            role: 'builder',
            machineId: 'machine-1',
            agentHarness: 'cursor-sdk',
            workingDir: '/tmp',
            spawnedAgentPid: 42,
            desiredState: 'running',
          },
        }),
        idleSlot({ pid: 42, nativeTurnPhase: 'turn_in_flight' })
      )
    ).toBe('turn_not_idle (nativeTurnPhase=turn_in_flight)');
  });

  it('allows a healthy local slot while the backend PID is still missing', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(
        task({
          agentConfig: {
            role: 'builder',
            machineId: 'machine-1',
            agentHarness: 'cursor-sdk',
            workingDir: '/tmp',
            desiredState: 'running',
          },
        }),
        idleSlot({ pid: 123 })
      )
    ).toBeNull();
  });

  it('allows a healthy local slot when snapshot spawnedAgentPid is stale from a prior agent', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(
        task({
          agentConfig: {
            role: 'builder',
            machineId: 'machine-1',
            agentHarness: 'cursor-sdk',
            workingDir: '/tmp',
            spawnedAgentPid: 42,
          },
        }),
        idleSlot({ pid: 99 })
      )
    ).toBeNull();
  });

  it('still blocks pid mismatch when local slot is not running', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(
        task({
          agentConfig: {
            role: 'builder',
            machineId: 'machine-1',
            agentHarness: 'cursor-sdk',
            workingDir: '/tmp',
            spawnedAgentPid: 42,
          },
        }),
        idleSlot({ pid: 99, state: 'spawning' })
      )
    ).toContain('pid_mismatch');
  });
});
