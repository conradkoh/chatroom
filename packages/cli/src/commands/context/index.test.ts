/**
 * Context Unit Tests
 *
 * Tests the context commands using injected dependencies.
 * Covers: auth validation, readContext success, listContexts success,
 * error handling for readContext and listContexts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextDeps } from './deps.js';
import { readContext, listContexts } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';

function createMockDeps(overrides?: Partial<ContextDeps>): ContextDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue('ctx_new_id'),
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

describe('readContext', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await readContext(TEST_CHATROOM_ID, { role: 'planner' }, deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Not authenticated');
    });
  });

  describe('success', () => {
    it('reads and displays context when backend returns messages', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        messages: [
          {
            _id: 'msg_1',
            _creationTime: Date.now(),
            senderRole: 'planner',
            type: 'text',
            content: 'Hello',
            classification: 'question',
          },
        ],
        pendingTasksForRole: 0,
        originMessage: null,
        classification: null,
      });

      await readContext(TEST_CHATROOM_ID, { role: 'planner' }, deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.query).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('CONTEXT FOR PLANNER');
      expect(output).toContain('Hello');
    });

    it('shows no context available when messages array is empty', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        messages: [],
        pendingTasksForRole: 0,
        originMessage: null,
        classification: null,
      });

      await readContext(TEST_CHATROOM_ID, { role: 'builder' }, deps);

      expect(exitSpy).not.toHaveBeenCalled();
      const output = getAllLogOutput();
      expect(output).toContain('No context available');
    });
  });

  describe('error handling', () => {
    it('exits with code 1 when backend query fails', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Convex connection failed')
      );

      await readContext(TEST_CHATROOM_ID, { role: 'planner' }, deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to read context');
      expect(getAllErrorOutput()).toContain('Convex connection failed');
    });
  });
});

describe('listContexts', () => {
  describe('success', () => {
    it('lists contexts when backend returns data', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          _id: 'ctx_1',
          createdBy: 'planner',
          createdAt: Date.now(),
          content: 'Summary of the feature',
          messageCountAtCreation: 5,
        },
      ]);

      await listContexts(TEST_CHATROOM_ID, { role: 'planner' }, deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.query).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('CONTEXTS');
      expect(output).toContain('Summary of the feature');
    });

    it('shows empty state when no contexts found', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await listContexts(TEST_CHATROOM_ID, { role: 'planner' }, deps);

      expect(exitSpy).not.toHaveBeenCalled();
      const output = getAllLogOutput();
      expect(output).toContain('No contexts found');
    });
  });

  describe('error handling', () => {
    it('exits with code 1 when backend query fails', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Permission denied')
      );

      await listContexts(TEST_CHATROOM_ID, { role: 'planner' }, deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to list contexts');
      expect(getAllErrorOutput()).toContain('Permission denied');
    });
  });
});
