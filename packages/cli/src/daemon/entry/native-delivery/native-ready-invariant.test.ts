import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { unregisterNativeDeliverySession } from './native-delivery-session-registry.js';
import { explainAgentReadyForNativeDeliveryBlock } from './native-ready-invariant.js';
import {
  operationalRow,
  registerTestNativeDeliverySession,
} from '../../infrastructure/agent-operational/test-support.js';

beforeEach(() =>
  registerTestNativeDeliverySession({
    runtime: undefined as never,
    effectContext: undefined as never,
    agentMgr: {} as never,
    sessionDeps: {} as never,
    machineId: 'machine-1',
    operationalRows: [operationalRow('room-1', 'builder', 'running')],
  })
);
afterEach(() => unregisterNativeDeliverySession());

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
    registerTestNativeDeliverySession({
      runtime: undefined as never,
      effectContext: undefined as never,
      agentMgr: {} as never,
      sessionDeps: {} as never,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'stopped')],
    });
    expect(explainAgentReadyForNativeDeliveryBlock(task(), undefined)).toBe(
      'operational_state_not_running (state=stopped)'
    );
  });

  it('blocks a pending task when its fresh snapshot says stopped', () => {
    registerTestNativeDeliverySession({
      runtime: undefined as never,
      effectContext: undefined as never,
      agentMgr: {} as never,
      sessionDeps: {} as never,
      machineId: 'machine-1',
      operationalRows: [operationalRow('room-1', 'builder', 'stopped')],
    });
    expect(explainAgentReadyForNativeDeliveryBlock(task(), idleSlot())).toBe(
      'operational_state_not_running (state=stopped)'
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
});
