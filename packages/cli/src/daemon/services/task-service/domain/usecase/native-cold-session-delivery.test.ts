import { describe, expect, it } from 'vitest';

import {
  explainColdSessionDeliveryBlock,
  isColdStartEligibleSlotState,
  isNativeColdSessionDeliveryOwnedSpawn,
  taskRequestsNativeColdSession,
} from './native-cold-session-delivery.js';

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

describe('native-cold-session-delivery', () => {
  it('detects explicit cold-session intent on tasks', () => {
    expect(taskRequestsNativeColdSession(coldTask)).toBe(true);
    expect(taskRequestsNativeColdSession({ ...coldTask, requestsNativeColdSession: false })).toBe(
      false
    );
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

  it('allows delivery-owned spawn when slot is idle', () => {
    expect(explainColdSessionDeliveryBlock(coldTask, undefined)).toBeNull();
  });

  it('blocks cold delivery while spawning or stopping', () => {
    expect(explainColdSessionDeliveryBlock(coldTask, { state: 'spawning' } as never)).toContain(
      'slot_spawning'
    );
    expect(explainColdSessionDeliveryBlock(coldTask, { state: 'stopping' } as never)).toContain(
      'slot_stopping'
    );
  });
});
