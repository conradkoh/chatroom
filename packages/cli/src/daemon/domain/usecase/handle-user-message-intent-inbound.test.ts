import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleUserMessageIntentInbound } from './handle-user-message-intent-inbound.js';
import type { UserMessageIntentInboundEvent } from './handle-user-message-intent-inbound.js';
import { listAssignedTaskSnapshotsForRole } from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import { getNativeTaskDeliveryCoordinator } from '../../entry/native-delivery/native-task-delivery-coordinator.js';
import { openDatabase } from '../../infrastructure/persistence/open-database.js';
import { listTaskReadModelsForChatroomRole } from '../../infrastructure/persistence/read-models/tasks.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p7-intent-'));
  return join(dir, 'events.sqlite');
}

function makeEvent(): UserMessageIntentInboundEvent {
  return {
    type: 'user-message.intent',
    chatroomId: 'room-1',
    taskId: 'task-1',
    role: 'builder',
    revisionKey: '1700000000000:task-1',
    agentHarness: 'cursor-sdk',
    workingDir: '/test/workspace',
    model: 'gpt-4o',
    createdAt: 1_700_000_000_000,
  };
}

describe('handleUserMessageIntentInbound', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts a pending read-model task and wakes the delivery coordinator', () => {
    const db = openDatabase(tempDbPath());
    const coordinator = getNativeTaskDeliveryCoordinator();
    const spy = vi.spyOn(coordinator, 'tryInjectNextForRole');
    try {
      handleUserMessageIntentInbound({ db, machineId: 'machine-1' }, makeEvent());

      const rows = listTaskReadModelsForChatroomRole(db, 'room-1', 'builder');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
        status: 'pending',
        assignedTo: 'builder',
        agentHarness: 'cursor-sdk',
        machineId: 'machine-1',
        workingDir: '/test/workspace',
        model: 'gpt-4o',
        createdAt: 1_700_000_000_000,
      });

      expect(spy).toHaveBeenCalledWith('room-1', 'builder');
      const snapshots = listAssignedTaskSnapshotsForRole('room-1', 'builder');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        taskId: 'task-1',
        status: 'pending',
        agentConfig: { role: 'builder', machineId: 'machine-1', agentHarness: 'cursor-sdk' },
      });
    } finally {
      db.close();
    }
  });

  it('is a no-op when no persistence db is wired (flag off / tests)', () => {
    const coordinator = getNativeTaskDeliveryCoordinator();
    const spy = vi.spyOn(coordinator, 'tryInjectNextForRole');
    handleUserMessageIntentInbound({ db: undefined, machineId: 'machine-1' }, makeEvent());
    expect(spy).not.toHaveBeenCalled();
  });
});
