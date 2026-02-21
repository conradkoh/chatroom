/**
 * task-complete Unit Tests
 *
 * Tests the task-complete command using injected dependencies.
 * Covers: auth validation, successful completion, no task to complete,
 * mutation failure (ConvexError handling).
 */

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskCompleteDeps } from './deps.js';
import { taskComplete, type TaskCompleteOptions } from './index.js';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/prompts/base/cli/wait-for-task/command.js', () => ({
  waitForTaskCommand: (opts: { chatroomId: string; role: string }) =>
    `chatroom wait-for-task --chatroom-id=${opts.chatroomId} --role=${opts.role}`,
}));

vi.mock('@workspace/backend/prompts/utils/env.js', () => ({
  getCliEnvPrefix: () => 'CHATROOM_CONVEX_URL=http://test:3210 ',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';

function createMockDeps(overrides?: Partial<TaskCompleteDeps>): TaskCompleteDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({
        completed: true,
        completedCount: 1,
        promoted: null,
      }),
      query: vi.fn().mockResolvedValue(null),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  };
}

function defaultOptions(overrides?: Partial<TaskCompleteOptions>): TaskCompleteOptions {
  return {
    role: 'planner',
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

describe('taskComplete', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await taskComplete(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('successful completion', () => {
    it('calls completeTask mutation and logs success', async () => {
      const deps = createMockDeps();

      await taskComplete(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      // completeTask + lifecycle heartbeat
      expect(deps.backend.mutation).toHaveBeenCalledTimes(2);

      const output = getAllLogOutput();
      expect(output).toContain('Task completed successfully');
      expect(output).toContain('Tasks completed: 1');
      expect(output).toContain('wait-for-task');
    });

    it('logs promoted task when result.promoted is set', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
        completed: true,
        completedCount: 1,
        promoted: 'task_promoted_123',
      });

      await taskComplete(TEST_CHATROOM_ID, defaultOptions(), deps);

      const output = getAllLogOutput();
      expect(output).toContain('Promoted next task: task_promoted_123');
    });
  });

  describe('no task to complete', () => {
    it('exits with code 1 when result.completed is false', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
        completed: false,
        completedCount: 0,
        promoted: null,
      });

      await taskComplete(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('No task to complete');
      expect(errOutput).toContain('in_progress task');
    });
  });

  describe('mutation failure', () => {
    it('exits with code 1 when completeTask throws generic error', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network timeout')
      );

      await taskComplete(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('Task completion failed');
      expect(errOutput).toContain('Network timeout');
    });

    it('exits with code 1 and shows auth hint when ConvexError has AUTH_FAILED', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ConvexError({ code: 'AUTH_FAILED', message: 'Session expired' })
      );

      await taskComplete(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('Task completion failed');
      expect(errOutput).toContain('Session expired');
      expect(errOutput).toContain('Try authenticating again');
    });
  });
});
