import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createBuilderEntryDuoChatroom, createTestSession, registerMachineWithDaemon, setupRemoteAgentConfig } from '../helpers/integration';

test('projectTaskStatusFromDaemon patches timestamps and dedupes receipts', async () => {
  const { sessionId } = await createTestSession(`daemon-status-${randomUUID()}`); const machineId = `machine-${randomUUID()}`;
  await registerMachineWithDaemon(sessionId, machineId); const chatroomId = await createBuilderEntryDuoChatroom(sessionId); await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', { agentHarness: 'cursor-sdk' });
  const messageId = await t.mutation(api.messages.sendMessage, { sessionId, chatroomId, senderRole: 'user', content: 'status', type: 'message' }); const daemonTaskId = randomUUID();
  const projected = await t.mutation(api.messages.projectUserMessageFromDaemon, { sessionId, machineId, chatroomId, messageId, content: 'status', senderRole: 'user', newTaskId: daemonTaskId, idempotencyKey: `${chatroomId}:${messageId}`, timestamp: Date.now() });
  const timestamp = Date.now(); const key = `status:${daemonTaskId}:in_progress`;
  const first = await t.mutation(api.machines.projectTaskStatusFromDaemon, { sessionId, machineId, daemonTaskId, status: 'in_progress', idempotencyKey: key, timestamp }); expect(first.replayed).toBe(false);
  const replay = await t.mutation(api.machines.projectTaskStatusFromDaemon, { sessionId, machineId, daemonTaskId, status: 'completed', idempotencyKey: key, timestamp: timestamp + 1 }); expect(replay.replayed).toBe(true);
  const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', projected.taskId)); expect(task?.status).toBe('in_progress'); expect(task?.startedAt).toBe(timestamp); expect(task?.updatedAt).toBe(timestamp);
});
