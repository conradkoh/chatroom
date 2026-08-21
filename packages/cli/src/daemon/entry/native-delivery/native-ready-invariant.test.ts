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
  it('blocks a stopped task when no local slot exists', () => {
    expect(explainAgentReadyForNativeDeliveryBlock(task(), undefined)).toBe(
      'desired_state_not_running (desiredState=stopped)'
    );
  });

  it('blocks a pending task when its fresh snapshot says stopped', () => {
    expect(explainAgentReadyForNativeDeliveryBlock(task(), idleSlot())).toBe(
      'desired_state_not_running (desiredState=stopped)'
    );
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
});
