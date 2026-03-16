/**
 * backlog Unit Tests
 *
 * Tests the backlog commands using injected dependencies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BacklogDeps } from './deps.js';
import { listBacklog, addBacklog, completeBacklog } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';
const TEST_TASK_ID = 'task_abc123_test_task_id_1';

function createMockDeps(overrides?: Partial<BacklogDeps>): BacklogDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([]),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitSpy: any;

let logSpy: any;

let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listBacklog', () => {
  it('exits with code 1 when not authenticated', async () => {
    const deps = createMockDeps({
      session: {
        getSessionId: vi.fn().mockReturnValue(null),
        getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
        getOtherSessionUrls: vi.fn().mockReturnValue([]),
      },
    });

    await listBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Not authenticated');
  });

  it('lists tasks successfully', async () => {
    const deps = createMockDeps();
    const mockCounts = {
      pending: 2,
      in_progress: 1,
      queued: 0,
      backlog: 3,
      pending_user_review: 0,
      completed: 5,
      closed: 0,
    };
    const mockTasks = [
      {
        _id: 'task1',
        content: 'Test task',
        status: 'backlog',
        createdAt: Date.now(),
        assignedTo: null,
      },
    ];

    (deps.backend.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockCounts) // getTaskCounts
      .mockResolvedValueOnce(mockTasks); // listTasks

    await listBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('TASK QUEUE');
    expect(output).toContain('Test task');
  });

  it('exits with code 1 when query fails', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection refused')
    );

    await listBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Failed to list tasks');
  });
});

describe('addBacklog', () => {
  it('adds a task to the backlog', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      taskId: 'new-task-id',
      status: 'backlog',
      queuePosition: 4,
    });

    await addBacklog(TEST_CHATROOM_ID, { role: 'planner', content: 'New task' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
    expect(getAllLogOutput()).toContain('Task added to backlog');
  });

  it('exits with code 1 when content is empty', async () => {
    const deps = createMockDeps();

    await addBacklog(TEST_CHATROOM_ID, { role: 'planner', content: '' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Task content cannot be empty');
  });
});

describe('completeBacklog', () => {
  it('completes a task', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      wasForced: false,
      promoted: null,
    });

    await completeBacklog(TEST_CHATROOM_ID, { role: 'planner', taskId: TEST_TASK_ID }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getAllLogOutput()).toContain('Task completed');
  });

  it('shows promoted task when present', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      wasForced: false,
      promoted: 'next-task-id',
    });

    await completeBacklog(TEST_CHATROOM_ID, { role: 'planner', taskId: TEST_TASK_ID }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getAllLogOutput()).toContain('Next task promoted');
  });
});
