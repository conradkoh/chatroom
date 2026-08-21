import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleTaskInboxUpdate } from './task-inbox-delivery.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import { processTasksUpdate } from '../../entry/native-delivery/task-delivery-processor.js';

vi.mock('../../entry/native-delivery/task-delivery-processor.js', () => ({
  processTasksUpdate: vi.fn().mockResolvedValue(undefined),
}));

function makeRow(overrides: Partial<AssignedTaskSnapshotView> = {}): AssignedTaskSnapshotView {
  return {
    taskId: 'task-1' as never,
    chatroomId: 'room-1' as never,
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 1,
    createdAt: 1,
    agentConfig: { role: 'builder', machineId: 'machine-1', agentHarness: 'cursor-sdk' },
    participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
    ...overrides,
  } as AssignedTaskSnapshotView;
}

describe('task inbox delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing for an empty update', async () => {
    await handleTaskInboxUpdate({ snapshots: [] } as never, {} as never);
    expect(processTasksUpdate).not.toHaveBeenCalled();
  });

  it('processes non-empty snapshots as signal delivery', async () => {
    const row = makeRow();
    await handleTaskInboxUpdate(
      { snapshots: [row] } as never,
      {
        runtime: {},
        effectContext: {},
        cooldown: {},
        agentMgr: {},
        sessionDeps: {},
        machineId: 'machine-1',
      } as never
    );
    expect(processTasksUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'machine-1',
      'inbox-signal'
    );
  });
});
