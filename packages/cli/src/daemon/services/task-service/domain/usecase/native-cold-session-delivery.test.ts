import { describe, expect, it } from 'vitest';

import {
  explainColdSessionDeliveryBlock,
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
  },
};

describe('native-cold-session-delivery', () => {
  it('detects explicit cold-session intent on tasks', () => {
    expect(taskRequestsNativeColdSession(coldTask)).toBe(true);
    expect(taskRequestsNativeColdSession({ ...coldTask, requestsNativeColdSession: false })).toBe(
      false
    );
  });

  it('allows delivery-owned spawn when no stop scope is active', () => {
    expect(explainColdSessionDeliveryBlock(coldTask)).toBeNull();
  });

  it('does not block ordinary tasks', () => {
    expect(explainColdSessionDeliveryBlock({ ...coldTask, requestsNativeColdSession: false })).toBe(
      null
    );
  });
});
