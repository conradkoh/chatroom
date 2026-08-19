import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function setup(prefix: string) {
  const { sessionId } = await createTestSession(`test-task-changes-${prefix}`);
  const machineId = `test-task-changes-${prefix}`;
  await registerMachineWithDaemon(sessionId, machineId);
  const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
  return { sessionId, machineId, chatroomId };
}
async function sync(sessionId: string, machineId: string) {
  await t.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, { sessionId, machineId });
}
async function create(
  input: { sessionId: string; chatroomId: Id<'chatroom_rooms'> },
  content = '## Goal\nchange'
) {
  return t.mutation(api.tasks.createTask, {
    sessionId: input.sessionId,
    chatroomId: input.chatroomId,
    content,
    createdBy: 'user',
  });
}

describe('machines.listMachineAssignedTaskChangesSince', () => {
  test('upsert create omits content and supports exclusive cursor', async () => {
    const x = await setup('upsert');
    const content = 'secret-task-content';
    await create(x, content);
    await sync(x.sessionId, x.machineId);
    const cursor = await t.query(api.machines.subscribeMachineTaskUpdateCursor, {
      sessionId: x.sessionId,
      machineId: x.machineId,
    });
    expect(cursor.latestRevision).toBeGreaterThanOrEqual(1);
    const page = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      afterRevision: 0,
      limit: 10,
    });
    expect(page.items[0]?.op).toBe('upsert');
    expect(page.items[0]?.role).toBe('builder');
    expect(page.items[0]?.snapshot?.status).toBe('pending');
    expect(JSON.stringify(page)).not.toContain(content);
    const empty = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      afterRevision: page.highRevision ?? 0,
      limit: 10,
    });
    expect(empty.items).toHaveLength(0);
    expect(empty.hasMore).toBe(false);
  });
  test('paginates revisions from config updates', async () => {
    const x = await setup('page');
    await create(x);
    await sync(x.sessionId, x.machineId);
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      chatroomId: x.chatroomId,
      role: 'builder',
      pid: 42424,
    });
    const page = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      afterRevision: 0,
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });
  test('returns delete after task completion', async () => {
    const x = await setup('delete');
    const created = await create(x);
    const taskId = created.taskId;
    await sync(x.sessionId, x.machineId);
    const before = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      limit: 10,
    });
    await t.mutation(api.tasks.completeTaskById, { sessionId: x.sessionId, taskId, force: true });
    const page = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      afterRevision: before.highRevision ?? 0,
      limit: 10,
    });
    expect(page.items.some((i) => i.op === 'delete' && i.taskId === taskId)).toBe(true);
  });
  test('rejects another session', async () => {
    const x = await setup('auth');
    const other = await createTestSession('test-task-changes-other');
    const cursor = await t.query(api.machines.subscribeMachineTaskUpdateCursor, {
      sessionId: other.sessionId,
      machineId: x.machineId,
    });
    const page = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: other.sessionId,
      machineId: x.machineId,
      limit: 10,
    });
    expect(cursor).toEqual({ latestRevision: 0, updatedAt: 0 });
    expect(page.items).toHaveLength(0);
  });
  test('excludes heartbeat-only updates', async () => {
    const x = await setup('heartbeat');
    await create(x);
    await t.mutation(api.participants.join, {
      sessionId: x.sessionId,
      chatroomId: x.chatroomId,
      role: 'builder',
      action: 'heartbeat',
    });
    await sync(x.sessionId, x.machineId);
    const before = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      limit: 10,
    });
    await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', x.chatroomId).eq('role', 'builder')
        )
        .unique();
      if (!p) throw new Error('participant not found');
      await ctx.db.patch('chatroom_participants', p._id, { lastSeenAt: Date.now() + 60_000 });
    });
    await sync(x.sessionId, x.machineId);
    const page = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      afterRevision: before.highRevision ?? 0,
      limit: 10,
    });
    expect(page.items).toHaveLength(0);
  });
  test('records participant action changes', async () => {
    const x = await setup('action');
    await create(x);
    await t.mutation(api.participants.join, {
      sessionId: x.sessionId,
      chatroomId: x.chatroomId,
      role: 'builder',
      action: 'first',
    });
    await sync(x.sessionId, x.machineId);
    const before = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      limit: 10,
    });
    await t.mutation(api.participants.join, {
      sessionId: x.sessionId,
      chatroomId: x.chatroomId,
      role: 'builder',
      action: 'second',
    });
    await sync(x.sessionId, x.machineId);
    const page = await t.query(api.machines.listMachineAssignedTaskChangesSince, {
      sessionId: x.sessionId,
      machineId: x.machineId,
      afterRevision: before.highRevision ?? 0,
      limit: 10,
    });
    expect(page.items.some((i) => i.op === 'upsert')).toBe(true);
  });
});
