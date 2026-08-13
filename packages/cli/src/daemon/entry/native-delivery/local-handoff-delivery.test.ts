import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { runNativeInjectionEffect } from './native-task-injector.js';
import type { AssignedTaskWithContent } from '../../../daemon/domain/entities/assigned-task.js';

describe('local handoff delivery', () => {
  it('injects stored task content without Convex calls', async () => {
    process.env.DAEMON_ORCHESTRATION_P2 = '1';
    process.env.DAEMON_ORCHESTRATION_P2_CUTOVER = '1';
    process.env.DAEMON_ORCHESTRATION_P3 = '1';
    process.env.DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY = '1';
    const query = vi.fn();
    const mutation = vi.fn();
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const task = {
      taskId: 'task-local',
      chatroomId: 'room-local',
      status: 'in_progress',
      assignedTo: 'builder',
      updatedAt: 1,
      createdAt: 1,
      taskContent: 'LOCAL HANDOFF CONTENT',
      agentConfig: { role: 'builder', machineId: 'machine-local', agentHarness: 'opencode' },
    } as AssignedTaskWithContent;
    try {
      await Effect.runPromise(
        runNativeInjectionEffect(task, 'harness-local', {
          localDelivery: true,
          sessionId: 'session-local',
          machineId: 'machine-local',
          backend: { query, mutation },
          agentMgr: { resumeTurnForSlot },
        })
      );
      expect(resumeTurnForSlot).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: expect.stringContaining('LOCAL HANDOFF CONTENT') })
      );
      expect(query).not.toHaveBeenCalled();
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      delete process.env.DAEMON_ORCHESTRATION_P2;
      delete process.env.DAEMON_ORCHESTRATION_P2_CUTOVER;
      delete process.env.DAEMON_ORCHESTRATION_P3;
      delete process.env.DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY;
    }
  });
});
