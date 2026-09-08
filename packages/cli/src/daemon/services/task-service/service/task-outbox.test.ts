import { describe, expect, test, vi } from 'vitest';

import { TaskOutbox } from './task-outbox.js';
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

describe('TaskOutbox', () => {
  test('serializes content sends per chatroom and role', async () => {
    const release: (() => void)[] = [];
    const calls: string[] = [];
    const outbox = new TaskOutbox(async ({ task: item }) => {
      calls.push(`start:${item.taskId}`);
      await new Promise<void>((resolve) => release.push(resolve));
      calls.push(`end:${item.taskId}`);
    });

    const first = outbox.enqueue({
      task: task('builder', 'one'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    const second = outbox.enqueue({
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
    const outbox = new TaskOutbox(sender);
    await Promise.all([
      outbox.enqueue({
        task: task('builder', 'one'),
        harnessSessionId: undefined,
        onTaskDelivered: undefined,
      }),
      outbox.enqueue({
        task: task('reviewer', 'two'),
        harnessSessionId: undefined,
        onTaskDelivered: undefined,
      }),
    ]);
    expect(sender).toHaveBeenCalledTimes(2);
  });
});
