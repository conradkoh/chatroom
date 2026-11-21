/**
 * `delivery_retrying` delivery failure: the warning the daemon records once a provider
 * failure has repeated. Covers recordability, idempotency, the completed-task guard, and
 * the clear rule that protects the warning from unconditional clears.
 */

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

async function createAssignedTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  assignedTo: string
): Promise<Id<'chatroom_tasks'>> {
  const { taskId } = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content,
    createdBy: 'user',
  });
  await t.run((ctx) => ctx.db.patch('chatroom_tasks', taskId, { assignedTo }));
  return taskId;
}

async function setupRoutedChatroom(name: string, machineId: string) {
  const { sessionId } = await createTestSession(name);
  await registerMachineWithDaemon(sessionId, machineId);
  const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
  return { sessionId, machineId, chatroomId };
}

const readFailure = async (taskId: Id<'chatroom_tasks'>) =>
  (await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId)))?.deliveryFailure;

describe('delivery_retrying delivery failure', () => {
  test('is recorded once; repeating the record is a no-op', async () => {
    const { sessionId, machineId, chatroomId } = await setupRoutedChatroom(
      'delivery-retrying-record',
      'machine-delivery-retrying-record'
    );
    const taskId = await createAssignedTask(sessionId, chatroomId, 'Retrying task', 'builder');

    const first = await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
      reason: 'delivery_retrying',
    });
    const second = await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
      reason: 'delivery_retrying',
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect((await readFailure(taskId))?.reason).toBe('delivery_retrying');
  });

  test('is refused on a completed task (control: recorded on an active task in the same chatroom)', async () => {
    const { sessionId, machineId, chatroomId } = await setupRoutedChatroom(
      'delivery-retrying-completed',
      'machine-delivery-retrying-completed'
    );
    const taskId = await createAssignedTask(sessionId, chatroomId, 'Will complete', 'builder');
    const activeTaskId = await createAssignedTask(sessionId, chatroomId, 'Stays active', 'builder');

    const control = await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId: activeTaskId,
      reason: 'delivery_retrying',
    });
    expect(control.recorded).toBe(true);

    await t.mutation(api.tasks.completeTaskById, { sessionId, taskId, force: true });
    const completed = await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(completed?.status).toBe('completed');

    const result = await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
      reason: 'delivery_retrying',
    });

    expect(result.recorded).toBe(false);
    expect(await readFailure(taskId)).toBe(undefined);
  });

  test('unconditional clear leaves a delivery_retrying warning in place', async () => {
    const { sessionId, machineId, chatroomId } = await setupRoutedChatroom(
      'delivery-retrying-keep',
      'machine-delivery-retrying-keep'
    );
    const taskId = await createAssignedTask(sessionId, chatroomId, 'Warned task', 'builder');
    await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
      reason: 'delivery_retrying',
    });

    const result = await t.mutation(api.daemon.taskStatus.clearDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
    });

    expect(result.cleared).toBe(false);
    expect((await readFailure(taskId))?.reason).toBe('delivery_retrying');
  });

  test('unconditional clear still clears injection_not_confirmed', async () => {
    const { sessionId, machineId, chatroomId } = await setupRoutedChatroom(
      'delivery-retrying-transport',
      'machine-delivery-retrying-transport'
    );
    const taskId = await createAssignedTask(sessionId, chatroomId, 'Transport task', 'builder');
    await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
      reason: 'injection_not_confirmed',
    });

    const result = await t.mutation(api.daemon.taskStatus.clearDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
    });

    expect(result.cleared).toBe(true);
    expect(await readFailure(taskId)).toBe(undefined);
  });

  test('explicit expectedReason delivery_retrying clears the warning', async () => {
    const { sessionId, machineId, chatroomId } = await setupRoutedChatroom(
      'delivery-retrying-explicit',
      'machine-delivery-retrying-explicit'
    );
    const taskId = await createAssignedTask(sessionId, chatroomId, 'Explicit task', 'builder');
    await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
      reason: 'delivery_retrying',
    });

    const result = await t.mutation(api.daemon.taskStatus.clearDeliveryFailure, {
      sessionId,
      machineId,
      taskId,
      expectedReason: 'delivery_retrying',
    });

    expect(result.cleared).toBe(true);
    expect(await readFailure(taskId)).toBe(undefined);
  });

  test('mismatched expectedReason is a no-op', async () => {
    const { sessionId, machineId, chatroomId } = await setupRoutedChatroom(
      'delivery-retrying-mismatch',
      'machine-delivery-retrying-mismatch'
    );
    const retryingTaskId = await createAssignedTask(
      sessionId,
      chatroomId,
      'Retrying task',
      'builder'
    );
    const transportTaskId = await createAssignedTask(
      sessionId,
      chatroomId,
      'Transport task',
      'builder'
    );

    await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId: retryingTaskId,
      reason: 'delivery_retrying',
    });
    await t.mutation(api.daemon.taskStatus.recordDeliveryFailure, {
      sessionId,
      machineId,
      taskId: transportTaskId,
      reason: 'injection_not_confirmed',
    });

    const firstMismatch = await t.mutation(api.daemon.taskStatus.clearDeliveryFailure, {
      sessionId,
      machineId,
      taskId: retryingTaskId,
      expectedReason: 'task_not_deliverable',
    });
    const secondMismatch = await t.mutation(api.daemon.taskStatus.clearDeliveryFailure, {
      sessionId,
      machineId,
      taskId: transportTaskId,
      expectedReason: 'delivery_retrying',
    });

    expect(firstMismatch.cleared).toBe(false);
    expect((await readFailure(retryingTaskId))?.reason).toBe('delivery_retrying');
    expect(secondMismatch.cleared).toBe(false);
    expect((await readFailure(transportTaskId))?.reason).toBe('injection_not_confirmed');
  });
});
