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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
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
      'invalidateRole',
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

  test('invalidation suppresses old queued entries and allows new epoch sends', async () => {
    const running = deferred();
    const started = deferred();
    const calls: string[] = [];
    const queue = new NativeTaskDeliveryQueue(async ({ task: item }) => {
      calls.push(item.taskId);
      if (item.taskId === 'running') {
        started.resolve();
        await running.promise;
      }
    });
    const first = queue.enqueue({
      task: task('builder', 'running'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    await started.promise;
    const stale = queue.enqueue({
      task: task('builder', 'stale'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    const invalidation = queue.invalidateRole('room-1', 'BUILDER');
    let drained = false;
    void invalidation.then(() => (drained = true));
    await Promise.resolve();
    expect(drained).toBe(false);
    running.resolve();
    await Promise.all([first, stale, invalidation]);
    expect(calls).toEqual(['running']);

    await queue.enqueue({
      task: task('builder', 'new'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    expect(calls).toEqual(['running', 'new']);
  });

  test('invalidation matches role names case-insensitively', async () => {
    const running = deferred();
    const started = deferred();
    const sender = vi.fn(async () => {
      started.resolve();
      await running.promise;
    });
    const queue = new NativeTaskDeliveryQueue(sender);
    const pending = queue.enqueue({
      task: task('Builder', 'one'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    await started.promise;
    const invalidation = queue.invalidateRole('room-1', 'builder');
    let drained = false;
    void invalidation.then(() => (drained = true));
    await Promise.resolve();
    expect(drained).toBe(false);
    running.resolve();
    await Promise.all([pending, invalidation]);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  test('stop cancels queued work and observes detached tail failures', async () => {
    const running = deferred();
    const started = deferred();
    const calls: string[] = [];
    const queue = new NativeTaskDeliveryQueue(async ({ task: item }) => {
      calls.push(item.taskId);
      if (item.taskId === 'running') {
        started.resolve();
        await running.promise;
        throw new Error('sender failed');
      }
    });
    const first = queue.enqueue({
      task: task('builder', 'running'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    await started.promise;
    const queued = queue.enqueue({
      task: task('builder', 'queued'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    queue.stop();
    const later = queue.enqueue({
      task: task('builder', 'later'),
      harnessSessionId: undefined,
      onTaskDelivered: undefined,
    });
    await expect(later).resolves.toBeUndefined();
    running.resolve();
    await expect(first).rejects.toThrow('sender failed');
    await expect(queued).resolves.toBeUndefined();
    expect(calls).toEqual(['running']);
  });
});
