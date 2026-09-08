import { describe, expect, it } from 'vitest';

import {
  explainColdSessionDeliveryBlock,
  isColdStartEligibleSlotState,
  isNativeColdSessionDeliveryOwnedSpawn,
  snapshotRequestsNativeColdSession,
} from './native-cold-session-delivery.js';
import type { MachineAgentOperationalRow } from '../../../../infrastructure/agent-operational/agent-operational-read-model.js';

const coldTask = {
  taskId: 'task-1',
  chatroomId: 'room-1',
  status: 'pending' as const,
  assignedTo: 'builder',
  updatedAt: 1,
  createdAt: 1,
  requestsNativeColdSession: true,
  agentConfig: {
    role: 'builder',
    machineId: 'machine-1',
    agentHarness: 'cursor-sdk',
    workingDir: '/tmp',
  },
};

function operational(
  overrides: Partial<MachineAgentOperationalRow> = {}
): MachineAgentOperationalRow {
  return {
    chatroomId: 'room-1',
    role: 'builder',
    operationalState: 'starting',
    isAlive: false,
    isRunning: false,
    daemonConnected: true,
    revisionKey: 'test:room-1:builder:starting',
    stopState: 'idle',
    ...overrides,
  };
}

describe('native-cold-session-delivery', () => {
  it('detects explicit cold-session intent on snapshots', () => {
    expect(snapshotRequestsNativeColdSession(coldTask)).toBe(true);
    expect(
      snapshotRequestsNativeColdSession({ ...coldTask, requestsNativeColdSession: false })
    ).toBe(false);
  });

  it('treats missing or idle slots as delivery-owned spawn for cold-session tasks', () => {
    expect(isNativeColdSessionDeliveryOwnedSpawn(coldTask, undefined)).toBe(true);
    expect(isNativeColdSessionDeliveryOwnedSpawn(coldTask, { state: 'idle' } as never)).toBe(true);
    expect(
      isNativeColdSessionDeliveryOwnedSpawn(
        { ...coldTask, requestsNativeColdSession: false },
        undefined
      )
    ).toBe(false);
  });

  it('does not treat transitions or running slots as delivery-owned down slots', () => {
    expect(isColdStartEligibleSlotState({ state: 'spawning' } as never)).toBe(false);
    expect(isColdStartEligibleSlotState({ state: 'stopping' } as never)).toBe(false);
    expect(isColdStartEligibleSlotState({ state: 'running' } as never)).toBe(false);
    expect(
      isNativeColdSessionDeliveryOwnedSpawn(coldTask, {
        state: 'spawning',
        pid: undefined,
        nativeTurnPhase: 'idle',
      } as never)
    ).toBe(false);
  });

  it('allows delivery-owned spawn when operational is starting and slot is idle', () => {
    expect(explainColdSessionDeliveryBlock(coldTask, undefined, operational())).toBeNull();
  });

  it('blocks cold delivery while spawning or stopping', () => {
    expect(
      explainColdSessionDeliveryBlock(coldTask, { state: 'spawning' } as never, operational())
    ).toContain('slot_spawning');
    expect(
      explainColdSessionDeliveryBlock(coldTask, { state: 'stopping' } as never, operational())
    ).toContain('slot_stopping');
  });

  it('blocks cold delivery on stop scope, stop intent, and circuit', () => {
    expect(
      explainColdSessionDeliveryBlock(coldTask, undefined, operational({ stopState: 'stopping' }))
    ).toBe('operational_stop_intent_active');
    expect(
      explainColdSessionDeliveryBlock(
        coldTask,
        undefined,
        operational({ operationalState: 'circuit_open' })
      )
    ).toBe('operational_circuit_open');
  });
});
