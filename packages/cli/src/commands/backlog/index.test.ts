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

  it('lists backlog items successfully', async () => {
    const deps = createMockDeps();
    const mockItems = [
      {
        _id: 'item1',
        content: 'Test backlog item',
        status: 'backlog',
        createdAt: Date.now(),
        assignedTo: null,
      },
    ];

    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockItems);

    await listBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('BACKLOG');
    expect(output).toContain('Test backlog item');
  });

  it('exits with code 1 when query fails', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection refused')
    );

    await listBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Failed to list backlog items');
  });
});

describe('addBacklog', () => {
  it('adds a backlog item', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-item-id');

    await addBacklog(TEST_CHATROOM_ID, { role: 'planner', content: 'New backlog item' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
    expect(getAllLogOutput()).toContain('Backlog item added');
  });

  it('exits with code 1 when content is empty', async () => {
    const deps = createMockDeps();

    await addBacklog(TEST_CHATROOM_ID, { role: 'planner', content: '' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Backlog item content cannot be empty');
  });
});

describe('completeBacklog', () => {
  it('completes a backlog item', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      wasForced: false,
      promoted: null,
    });

    await completeBacklog(TEST_CHATROOM_ID, { role: 'planner', backlogItemId: TEST_TASK_ID }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getAllLogOutput()).toContain('Backlog item completed');
  });

  it('shows promoted task when present', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      wasForced: false,
      promoted: 'next-task-id',
    });

    await completeBacklog(TEST_CHATROOM_ID, { role: 'planner', backlogItemId: TEST_TASK_ID }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getAllLogOutput()).toContain('Next task promoted');
  });
});
