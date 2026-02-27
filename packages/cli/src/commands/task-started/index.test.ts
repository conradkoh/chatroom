/**
 * task-started Unit Tests
 *
 * Tests the task-started command using injected dependencies.
 * Covers: auth validation, input validation, task fetching,
 * start task, no-classify mode, classification with reminder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskStartedDeps } from './deps.js';
import { taskStarted, type TaskStartedOptions } from './index.js';

// ---------------------------------------------------------------------------
// Mock modules (only for non-injectable side effects)
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/prompts/cli/task-started/command.js', () => ({
  taskStartedCommand: (opts: { chatroomId: string; role: string; taskId: string }) =>
    `chatroom task-started --chatroom-id=${opts.chatroomId} --role=${opts.role} --task-id=${opts.taskId}`,
}));

vi.mock('@workspace/backend/prompts/utils/env.js', () => ({
  getCliEnvPrefix: () => 'CHATROOM_CONVEX_URL=http://test:3210 ',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_TASK_ID = 'task_abc123_test_task_id_1';
const TEST_SESSION_ID = 'test-session-id';

function createMockDeps(overrides?: Partial<TaskStartedDeps>): TaskStartedDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({ reminder: null }),
      query: vi.fn().mockResolvedValue({ content: 'Test task content', status: 'acknowledged' }),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  };
}

function defaultOptions(overrides?: Partial<TaskStartedOptions>): TaskStartedOptions {
  return {
    role: 'planner',
    taskId: TEST_TASK_ID,
    originMessageClassification: 'question',
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

describe('taskStarted', () => {
  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await taskStarted(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Not authenticated');
    });

    it('shows other session URLs when available', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue(['http://other:3210']),
        },
      });

      await taskStarted(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('http://other:3210');
    });
  });

  // -----------------------------------------------------------------------
  // No-classify mode (handoff recipients)
  // -----------------------------------------------------------------------
  describe('no-classify mode', () => {
    it('starts task and returns without classifying', async () => {
      const deps = createMockDeps();

      await taskStarted(
        TEST_CHATROOM_ID,
        defaultOptions({ noClassify: true, originMessageClassification: undefined }),
        deps
      );

      expect(exitSpy).not.toHaveBeenCalled();

      // startTask only (heartbeat now fired by preAction hook, not handler)
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Task started');
      expect(output).toContain('Test task content');
    });
  });

  // -----------------------------------------------------------------------
  // Classification mode
  // -----------------------------------------------------------------------
  describe('classification mode', () => {
    it('starts task and classifies as question', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
        reminder: 'Focus on answering the question directly',
      });

      await taskStarted(
        TEST_CHATROOM_ID,
        defaultOptions({ originMessageClassification: 'question' }),
        deps
      );

      expect(exitSpy).not.toHaveBeenCalled();

      // Three mutations: startTask + taskStarted (classify)
      expect(deps.backend.mutation).toHaveBeenCalledTimes(2);

      const output = getAllLogOutput();
      expect(output).toContain('Task acknowledged and classified');
      expect(output).toContain('Classification: question');
      expect(output).toContain('Focus on answering the question directly');
    });

    it('starts task and classifies as follow_up', async () => {
      const deps = createMockDeps();

      await taskStarted(
        TEST_CHATROOM_ID,
        defaultOptions({ originMessageClassification: 'follow_up' }),
        deps
      );

      expect(exitSpy).not.toHaveBeenCalled();
      // participants.heartbeat + startTask + taskStarted (classify)
      expect(deps.backend.mutation).toHaveBeenCalledTimes(2);

      const output = getAllLogOutput();
      expect(output).toContain('Classification: follow_up');
    });
  });

  // -----------------------------------------------------------------------
  // Task not found
  // -----------------------------------------------------------------------
  describe('task not found', () => {
    it('exits with code 1 when task does not exist', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await taskStarted(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Task with ID');
      expect(getAllErrorOutput()).toContain('not found');
    });
  });

  // -----------------------------------------------------------------------
  // Start task failure
  // -----------------------------------------------------------------------
  describe('start task failure', () => {
    it('exits with code 1 when startTask mutation fails', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Task must be acknowledged to start')
      );

      await taskStarted(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to start task');
      expect(getAllErrorOutput()).toContain('Task must be acknowledged to start');
    });
  });

  // -----------------------------------------------------------------------
  // Classification failure
  // -----------------------------------------------------------------------
  describe('classification failure', () => {
    it('exits with code 1 when classification mutation fails', async () => {
      const deps = createMockDeps();
      // First: startTask succeeds, second: classify fails
      (deps.backend.mutation as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined) // startTask
        .mockRejectedValueOnce(new Error('Classification failed'));

      await taskStarted(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to acknowledge task');
      expect(getAllErrorOutput()).toContain('Classification failed');
    });
  });
});
