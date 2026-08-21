import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleTaskInboxUpdate, mergeSnapshotsIntoStore } from './task-inbox-delivery.js';
import {
  clearAssignedTaskSnapshots,
  listAssignedTaskSnapshots,
  replaceAssignedTaskSnapshots,
} from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
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
    clearAssignedTaskSnapshots();
    vi.clearAllMocks();
  });

  it('overlays incoming rows by task and role while preserving others', () => {
    replaceAssignedTaskSnapshots([makeRow({ taskId: 'other' as never })]);
    mergeSnapshotsIntoStore([makeRow({ status: 'in_progress' })]);
    expect(listAssignedTaskSnapshots()).toEqual([
      expect.objectContaining({ taskId: 'other' }),
      expect.objectContaining({ taskId: 'task-1', status: 'in_progress' }),
    ]);
  });

  it('does nothing for an empty update', async () => {
    await handleTaskInboxUpdate({ snapshots: [] } as never, {} as never);
    expect(processTasksUpdate).not.toHaveBeenCalled();
  });

  it('stores snapshots and processes them as signal delivery', async () => {
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
    expect(listAssignedTaskSnapshots()).toEqual([row]);
    expect(processTasksUpdate).toHaveBeenCalledWith(
      row ? [row] : [],
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'machine-1',
      'signal'
    );
  });
});
