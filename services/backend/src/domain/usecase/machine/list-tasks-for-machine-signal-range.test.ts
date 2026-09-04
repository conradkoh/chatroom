import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { assignedTaskSnapshotFromDoc } from './assigned-task-snapshot-row';
import { listTasksForMachineSignalRange } from './list-tasks-for-machine-signal-range';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

const now = 1_700_000_000_000;

async function createRoom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['builder', 'planner'],
    teamEntryPoint: 'planner',
  });
}

async function seed(kind: 'happy' | 'mismatch' | 'missing' | 'norole' | 'page') {
  const sessionId = `hydration-${kind}-${Math.random()}` as SessionId;
  const machineId = `hydration-test-machine-${kind}-${Math.random()}`;
  await t.mutation(api.auth.loginAnon, { sessionId });
  const chatroomId = await createRoom(sessionId);
  return t.run(async (ctx) => {
    const count = kind === 'page' ? 3 : 1;
    const rows: { key: string; snapshot?: any | undefined }[] = [];
    for (let i = 0; i < count; i++) {
      const updatedAt = now + i;
      const taskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: `task ${i}`,
        status: 'pending',
        assignedTo: kind === 'mismatch' ? 'planner' : 'builder',
        createdAt: updatedAt,
        updatedAt,
        queuePosition: i,
      });
      const key = `${String(updatedAt).padStart(16, '0')}:${taskId}`;
      const snapshot =
        kind === 'missing'
          ? undefined
          : await ctx.db.insert('chatroom_machineAssignedTaskSnapshots', {
              machineId,
              taskId,
              chatroomId,
              role: 'builder',
              taskStatus: 'pending',
              taskAssignedTo: 'builder',
              taskCreatedAt: updatedAt,
              taskUpdatedAt: updatedAt,
              agentHarness: 'opencode',
              workingDir: '/tmp',
              configUpdatedAt: updatedAt,
              presenceUpdatedAt: updatedAt,
              presenceKey: `p-${i}`,
              revisionKey: `r-${i}`,
              signalUpdatedAt: updatedAt,
            });
      await ctx.db.insert('chatroom_machineTaskStatusSignals', {
        chatroomId,
        taskId,
        machineId: machineId,
        targetRole: 'builder',
        taskStatus: 'pending',
        signalKey: key,
        taskUpdatedAt: updatedAt,
      });
      rows.push({ key, snapshot: snapshot ? await ctx.db.get(snapshot) : undefined });
    }
    return { machineId, chatroomId, rows };
  });
}

async function query(
  machineId: string,
  chatroomId: string,
  after: string,
  through: string,
  limit = 10
) {
  return t.run((ctx) =>
    listTasksForMachineSignalRange(ctx, {
      machineId,
      chatroomId,
      userId: 'unused',
      afterSignalKey: after,
      throughSignalKey: through,
      limit,
    })
  );
}

describe('listTasksForMachineSignalRange', () => {
  test('returns matching owned snapshot rows', async () => {
    const {
      machineId,
      chatroomId,
      rows: [row],
    } = await seed('happy');
    const result = await query(machineId, String(chatroomId), '', row.key);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]).toEqual(assignedTaskSnapshotFromDoc(row.snapshot!));
  });
  test('skips changed ownership', async () => {
    const {
      machineId,
      chatroomId,
      rows: [row],
    } = await seed('mismatch');
    expect((await query(machineId, String(chatroomId), '', row.key)).snapshots).toHaveLength(0);
  });
  test('skips missing snapshots', async () => {
    const {
      machineId,
      chatroomId,
      rows: [row],
    } = await seed('missing');
    expect((await query(machineId, String(chatroomId), '', row.key)).snapshots).toHaveLength(0);
  });
  test('respects limit and reports more', async () => {
    const { machineId, chatroomId, rows } = await seed('page');
    const result = await query(machineId, String(chatroomId), '', rows[2].key, 2);
    expect(result.snapshots).toHaveLength(2);
    expect(result.nextSignalKey).toBe(rows[1].key);
    expect(result.hasMore).toBe(true);
  });
  test("never returns another room's snapshots in an overlapping key range", async () => {
    const sessionId = `hydration-cross-room-${Math.random()}` as SessionId;
    const machineId = `hydration-cross-machine-${Math.random()}`;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const roomA = await createRoom(sessionId);
    const roomB = await createRoom(sessionId);

    const { roomAKey, roomBKey } = await t.run(async (ctx) => {
      const insertRoomTask = async (chatroomId: Id<'chatroom_rooms'>) => {
        const taskId = await ctx.db.insert('chatroom_tasks', {
          chatroomId,
          createdBy: 'user',
          content: `task for ${chatroomId}`,
          status: 'pending',
          assignedTo: 'builder',
          createdAt: now,
          updatedAt: now,
          queuePosition: 0,
        });
        await ctx.db.insert('chatroom_machineAssignedTaskSnapshots', {
          machineId,
          taskId,
          chatroomId,
          role: 'builder',
          taskStatus: 'pending',
          taskAssignedTo: 'builder',
          taskCreatedAt: now,
          taskUpdatedAt: now,
          agentHarness: 'opencode',
          workingDir: '/tmp',
          configUpdatedAt: now,
          presenceUpdatedAt: now,
          presenceKey: `p-${String(chatroomId)}`,
          revisionKey: `r-${String(chatroomId)}`,
          signalUpdatedAt: now,
        });
        const key = `${String(now).padStart(16, '0')}:${taskId}`;
        await ctx.db.insert('chatroom_machineTaskStatusSignals', {
          chatroomId,
          taskId,
          machineId,
          targetRole: 'builder',
          taskStatus: 'pending',
          signalKey: key,
          taskUpdatedAt: now,
        });
        return key;
      };
      const aKey = await insertRoomTask(roomA);
      const bKey = await insertRoomTask(roomB);
      return { roomAKey: aKey, roomBKey: bKey };
    });

    // Room B's signal shares the same padded timestamp prefix as Room A's, so the
    // full-range query would overlap both rooms under machine-wide scoping.
    expect(roomAKey.slice(0, 16)).toBe(roomBKey.slice(0, 16));
    const through = roomAKey > roomBKey ? roomAKey : roomBKey;
    const result = await query(machineId, String(roomA), '', through);

    expect(result.snapshots).toHaveLength(1);
    expect(String(result.snapshots[0].chatroomId)).toBe(String(roomA));
    expect(result.nextSignalKey).toBe(roomAKey);
    expect(result.hasMore).toBe(false);

    const roomBResult = await query(machineId, String(roomB), '', through);
    expect(roomBResult.snapshots).toHaveLength(1);
    expect(String(roomBResult.snapshots[0].chatroomId)).toBe(String(roomB));
    expect(roomBResult.nextSignalKey).toBe(roomBKey);
  });
});
