/**
 * Task inbox primitives.
 *
 * The inbox deliberately subscribes only to timeline task-status signals. Full
 * task rows are hydrated imperatively after a signal arrives, which keeps task
 * content out of the reactive subscription payload.
 */

import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { Doc } from '../../../api.js';
import { api } from '../../../api.js';

const DEFAULT_SIGNAL_PAGE_LIMIT = 100;
const DEFAULT_TASK_PAGE_LIMIT = 500;

export type TaskStatusSignal = Pick<
  Doc<'chatroom_timelineTaskStatusSignals'>,
  | 'chatroomId'
  | 'taskId'
  | 'targetMachineId'
  | 'targetRole'
  | 'taskStatus'
  | 'signalKey'
  | 'taskUpdatedAt'
>;

export interface TaskSignalPage {
  readonly items: readonly TaskStatusSignal[];
  readonly afterSignalKey: string;
  readonly highSignalKey: string;
}

export interface TaskInboxUpdate {
  readonly signals: readonly TaskStatusSignal[];
  readonly tasks: readonly Doc<'chatroom_tasks'>[];
  readonly afterSignalKey: string;
  readonly throughSignalKey: string;
}

export interface TaskInboxOptions {
  readonly client: ConvexClient;
  readonly sessionId: SessionId;
  readonly machineId: string;
  /** Defaults to the time the iterator is created. */
  readonly serviceStartedAt?: number;
  /** Overrides the initial timeline signal cursor. */
  readonly initialAfterSignalKey?: string;
  readonly signalPageLimit?: number;
  readonly taskPageLimit?: number;
  readonly signal?: AbortSignal;
}

export type TaskInboxHandler = (update: TaskInboxUpdate) => Promise<void>;

/**
 * Builds the exclusive signal cursor immediately before all signals at a time.
 * Timeline signal keys are `<zero-padded taskUpdatedAt>:<taskId>`.
 */
export function taskSignalCursorAt(timestamp: number): string {
  return `${String(Math.max(0, Math.floor(timestamp))).padStart(16, '0')}:`;
}

function abortError(): Error {
  const error = new Error('Task inbox stopped');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function waitForTaskSignalPage(
  options: TaskInboxOptions,
  afterSignalKey: string
): Promise<TaskSignalPage> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;

    const cleanup = (): void => {
      unsubscribe?.();
      unsubscribe = undefined;
      options.signal?.removeEventListener('abort', onAbort);
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = (): void => {
      settle(() => reject(abortError()));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      throwIfAborted(options.signal);
    } catch (error) {
      settle(() => reject(error));
      return;
    }

    unsubscribe = options.client.onUpdate(
      api.messageList.subscribeTaskStatusSignalsSince,
      {
        sessionId: options.sessionId,
        machineId: options.machineId,
        afterKey: afterSignalKey,
        limit: options.signalPageLimit ?? DEFAULT_SIGNAL_PAGE_LIMIT,
      },
      (result: unknown) => {
        if (!result || typeof result !== 'object') return;

        const page = result as {
          items?: readonly TaskStatusSignal[];
          highKey?: string | null;
        };
        const items = page.items;
        const highKey = page.highKey;
        if (!items?.length || !highKey) return;

        settle(() =>
          resolve({
            items,
            afterSignalKey,
            highSignalKey: highKey,
          })
        );
      },
      (error: unknown) => {
        settle(() => reject(error));
      }
    );
  });
}

/**
 * Waits for signal pages and advances the subscription cursor only after the
 * consumer resumes the iterator. Therefore, if processing throws, the cursor
 * remains unchanged and the page can be retried by the caller.
 */
export async function* createTaskSignalIterator(
  options: TaskInboxOptions
): AsyncGenerator<TaskSignalPage, void, void> {
  let afterSignalKey =
    options.initialAfterSignalKey ?? taskSignalCursorAt(options.serviceStartedAt ?? Date.now());

  while (!options.signal?.aborted) {
    const page = await waitForTaskSignalPage(options, afterSignalKey);
    yield page;
    afterSignalKey = page.highSignalKey;
  }
}

async function fetchFullTasksForSignalPage(
  options: TaskInboxOptions,
  page: TaskSignalPage
): Promise<readonly Doc<'chatroom_tasks'>[]> {
  const tasks: Doc<'chatroom_tasks'>[] = [];
  let afterSignalKey = page.afterSignalKey;
  while (true) {
    throwIfAborted(options.signal);
    const result = await options.client.query(api.tasks.listTasksForMachineSignalRange, {
      sessionId: options.sessionId,
      machineId: options.machineId,
      afterSignalKey,
      throughSignalKey: page.highSignalKey,
      limit: options.taskPageLimit ?? DEFAULT_TASK_PAGE_LIMIT,
    });

    tasks.push(...result.tasks);
    if (!result.hasMore || !result.nextSignalKey) break;
    afterSignalKey = result.nextSignalKey;
  }

  return tasks;
}

/**
 * Runs the inbox loop. The signal cursor is advanced by the async iterator only
 * after `onUpdate` resolves, then the next signal subscription is established.
 */
export async function runTaskInbox(
  options: TaskInboxOptions,
  onUpdate: TaskInboxHandler
): Promise<void> {
  for await (const page of createTaskSignalIterator(options)) {
    const tasks = await fetchFullTasksForSignalPage(options, page);
    await onUpdate({
      signals: page.items,
      tasks,
      afterSignalKey: page.afterSignalKey,
      throughSignalKey: page.highSignalKey,
    });
  }
}
