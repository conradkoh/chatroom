import { readFileSync } from 'node:fs';

import { describe, expect, test, vi } from 'vitest';

import { NativeTaskDeliveryQueue } from './native-task-delivery-queue.js';
import type { AssignedTaskWithContent } from '../../../domain/entities/assigned-task.js';

function task(role: string, id: string): AssignedTaskWithContent {
  return {
    taskId: id,
    chatroomId: 'room-1',
    status: 'acknowledged',
    assignedTo: role,
    taskContent: id,
    updatedAt: 1,
    createdAt: 1,
    agentConfig: { role, machineId: 'machine-1', agentHarness: 'cursor-sdk', workingDir: '/tmp' },
  } as AssignedTaskWithContent;
}

describe('NativeTaskDeliveryQueue', () => {
  test('serializes content sends per chatroom and role', async () => {
    const release: (() => void)[] = [];
    const calls: string[] = [];
    const queue = new NativeTaskDeliveryQueue(async ({ task: item }) => {
      calls.push(`start:${item.taskId}`);
      await new Promise<void>((resolve) => release.push(resolve));
      calls.push(`end:${item.taskId}`);
    });

    const first = queue.enqueue({
      task: task('builder', 'one'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    const second = queue.enqueue({
      task: task('builder', 'two'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['start:one']);
    release.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['start:one', 'end:one', 'start:two']);
    release.shift()?.();
    await Promise.all([first, second]);
  });

  test('allows different roles to send concurrently', async () => {
    const sender = vi.fn(async () => undefined);
    const queue = new NativeTaskDeliveryQueue(sender);
    await Promise.all([
      queue.enqueue({
        task: task('builder', 'one'),
        harnessSessionId: undefined,
        onTaskDelivered: undefined,
      }),
      queue.enqueue({
        task: task('reviewer', 'two'),
        harnessSessionId: undefined,
        onTaskDelivered: undefined,
      }),
    ]);
    expect(sender).toHaveBeenCalledTimes(2);
  });

  test('exposes only scheduling operations and has no subscription or Convex surface', () => {
    expect(Object.getOwnPropertyNames(NativeTaskDeliveryQueue.prototype).sort()).toEqual([
      'constructor',
      'enqueue',
      'stop',
    ]);
    const source = readFileSync(
      new URL('./native-task-delivery-queue.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/subscribe/i);
    expect(source).not.toContain('TaskServiceNotification');
    expect(source).not.toMatch(/from '.*api\.js'/);
    expect(source).not.toContain('convex');
  });
});
