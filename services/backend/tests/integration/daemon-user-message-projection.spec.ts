import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import type { Id } from '../../convex/_generated/dataModel';
import { createBuilderEntryDuoChatroom, createTestSession, registerMachineWithDaemon, setupRemoteAgentConfig } from '../helpers/integration';

async function setup() {
  const { sessionId } = await createTestSession(`daemon-projection-${randomUUID()}`);
  const machineId = `machine-${randomUUID()}`;
  await registerMachineWithDaemon(sessionId, machineId);
  const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', { agentHarness: 'cursor-sdk' });
  const messageId = await t.mutation(api.messages.sendMessage, { sessionId, chatroomId, senderRole: 'user', content: 'Projection content', type: 'message' });
  return { sessionId, machineId, chatroomId, messageId };
}

describe('projectUserMessageFromDaemon', () => {
  test('projects using source identity, stored content, and entry point', async () => {
    const s = await setup(); const daemonTaskId = randomUUID();
    const result = await t.mutation(api.messages.projectUserMessageFromDaemon, { ...s, content: 'ignored', senderRole: 'user', newTaskId: daemonTaskId, idempotencyKey: `${s.chatroomId}:${s.messageId}`, timestamp: Date.now() });
    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', result.taskId));
    expect(task).toMatchObject({ daemonTaskId, assignedTo: 'builder', sourceMessageId: s.messageId, content: 'Projection content', status: 'pending' });
  });

  test('replays exactly and rejects conflicting identity', async () => {
    const s = await setup(); const daemonTaskId = randomUUID(); const args = { ...s, content: 'ignored', senderRole: 'user', newTaskId: daemonTaskId, idempotencyKey: `${s.chatroomId}:${s.messageId}`, timestamp: Date.now() };
    const first = await t.mutation(api.messages.projectUserMessageFromDaemon, args);
    const replay = await t.mutation(api.messages.projectUserMessageFromDaemon, args);
    expect(replay.replayed).toBe(true);
    await expect(t.mutation(api.messages.projectUserMessageFromDaemon, { ...args, newTaskId: randomUUID() })).rejects.toThrow(/identity|conflict/i);
    const tasks = await t.run(async (ctx) => ctx.db.query('chatroom_tasks').withIndex('by_chatroom', (q) => q.eq('chatroomId', s.chatroomId)).filter((q) => q.eq(q.field('sourceMessageId'), s.messageId)).collect());
    expect(tasks).toHaveLength(1); expect(replay.taskId).toBe(first.taskId);
  });

  test('rejects an owned machine not bound to the entry point', async () => {
    const s = await setup(); const other = `machine-${randomUUID()}`; await registerMachineWithDaemon(s.sessionId, other);
    await expect(t.mutation(api.messages.projectUserMessageFromDaemon, { ...s, machineId: other, content: 'x', senderRole: 'user', newTaskId: randomUUID(), idempotencyKey: `${s.chatroomId}:${s.messageId}`, timestamp: Date.now() })).rejects.toThrow(/machine|binding/i);
  });
});
