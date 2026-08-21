import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { assignedTaskSnapshotFromDoc } from './assigned-task-snapshot-row';
import { listTasksForMachineSignalRange } from './list-tasks-for-machine-signal-range';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';

const now = 1_700_000_000_000;

async function seed(kind: 'happy' | 'mismatch' | 'missing' | 'norole' | 'page') {
  const sessionId = `hydration-${kind}-${Math.random()}` as SessionId;
  const machineId = `hydration-test-machine-${kind}-${Math.random()}`;
  await t.mutation(api.auth.loginAnon, { sessionId });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['builder', 'planner'],
    teamEntryPoint: 'planner',
  });
  return t.run(async (ctx) => {
    const count = kind === 'page' ? 3 : 1;
    const rows: { key: string; snapshot?: any }[] = [];
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
        targetRole: kind === 'norole' ? undefined : 'builder',
        taskStatus: 'pending',
        signalKey: key,
        taskUpdatedAt: updatedAt,
      });
      rows.push({ key, snapshot: snapshot ? await ctx.db.get(snapshot) : undefined });
    }
    return { machineId, rows };
  });
}

async function query(machineId: string, after: string, through: string, limit = 10) {
  return t.run((ctx) =>
    listTasksForMachineSignalRange(ctx, {
      machineId,
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
      rows: [row],
    } = await seed('happy');
    const result = await query(machineId, '', row.key);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]).toEqual(assignedTaskSnapshotFromDoc(row.snapshot!));
  });
  test('skips changed ownership', async () => {
    const {
      machineId,
      rows: [row],
    } = await seed('mismatch');
    expect((await query(machineId, '', row.key)).snapshots).toHaveLength(0);
  });
  test('skips missing snapshots', async () => {
    const {
      machineId,
      rows: [row],
    } = await seed('missing');
    expect((await query(machineId, '', row.key)).snapshots).toHaveLength(0);
  });
  test('respects limit and reports more', async () => {
    const { machineId, rows } = await seed('page');
    const result = await query(machineId, '', rows[2].key, 2);
    expect(result.snapshots).toHaveLength(2);
    expect(result.nextSignalKey).toBe(rows[1].key);
    expect(result.hasMore).toBe(true);
  });
});
