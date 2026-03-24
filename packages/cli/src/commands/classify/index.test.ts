/**
 * classify Unit Tests
 *
 * Tests the classify command using injected dependencies.
 * Covers: auth validation, entry-point role validation, input validation,
 * task fetching, start task, classification with reminder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClassifyDeps } from './deps.js';
import { classify, type ClassifyOptions } from './index.js';

// ---------------------------------------------------------------------------
// Mock modules (only for non-injectable side effects)
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/prompts/cli/classify/command.js', () => ({
  classifyCommand: (opts: { chatroomId: string; role: string; taskId: string }) =>
    `chatroom classify --chatroom-id=${opts.chatroomId} --role=${opts.role} --task-id=${opts.taskId}`,
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

function createMockDeps(overrides?: Partial<ClassifyDeps>): ClassifyDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({ reminder: null }),
      query: vi.fn().mockResolvedValue({
        content: 'Test task content',
        status: 'acknowledged',
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      }),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  };
}

function defaultOptions(overrides?: Partial<ClassifyOptions>): ClassifyOptions {
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

describe('classify', () => {
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

      await classify(TEST_CHATROOM_ID, defaultOptions(), deps);

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

      await classify(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('http://other:3210');
    });
  });

  // -----------------------------------------------------------------------
  // Entry-point role validation
  // -----------------------------------------------------------------------
  describe('entry-point role validation', () => {
    it('allows classification when role is the entry point', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      });

      await classify(TEST_CHATROOM_ID, defaultOptions({ role: 'planner' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      // taskStarted (classify)
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
    });

    it('exits with code 1 when role is not the entry point', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      });

      await classify(TEST_CHATROOM_ID, defaultOptions({ role: 'builder' }), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('`classify` is only available to the entry point role');
      expect(getAllErrorOutput()).toContain('Your role is builder');
    });

    it('uses first role as entry point when teamEntryPoint is not set', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamRoles: ['planner', 'builder'],
      });

      await classify(TEST_CHATROOM_ID, defaultOptions({ role: 'planner' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('works when no team configuration exists (defaults to allowing)', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await classify(TEST_CHATROOM_ID, defaultOptions({ role: 'planner' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Classification
  // -----------------------------------------------------------------------
  describe('classification', () => {
    it('starts task and classifies as question', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      });
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
        reminder: 'Focus on answering the question directly',
      });

      await classify(
        TEST_CHATROOM_ID,
        defaultOptions({ originMessageClassification: 'question' }),
        deps
      );

      expect(exitSpy).not.toHaveBeenCalled();

      // One mutation: taskStarted (classify)
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Task acknowledged and classified');
      expect(output).toContain('Classification: question');
      expect(output).toContain('Focus on answering the question directly');
    });

    it('starts task and classifies as follow_up', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      });

      await classify(
        TEST_CHATROOM_ID,
        defaultOptions({ originMessageClassification: 'follow_up' }),
        deps
      );

      expect(exitSpy).not.toHaveBeenCalled();
      // taskStarted (classify)
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Classification: follow_up');
    });

    it('starts task and classifies as new_feature with stdin', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      });
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
        reminder: null,
      });

      await classify(
        TEST_CHATROOM_ID,
        defaultOptions({
          originMessageClassification: 'new_feature',
          rawStdin: '---TITLE---\nTest\n---DESCRIPTION---\nDesc\n---TECH_SPECS---\nSpecs',
        }),
        deps
      );

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
    });

    it('exits when new_feature classification has no stdin', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      });

      await classify(
        TEST_CHATROOM_ID,
        defaultOptions({ originMessageClassification: 'new_feature', rawStdin: '' }),
        deps
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('new_feature classification requires stdin');
    });
  });

  // -----------------------------------------------------------------------
  // Task not found
  // -----------------------------------------------------------------------
  describe('task not found', () => {
    it('exits with code 1 when task does not exist', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      });
      // First call returns chatroom, second call returns null for task
      (deps.backend.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          teamEntryPoint: 'planner',
          teamRoles: ['planner', 'builder'],
        })
        .mockResolvedValueOnce(null);

      await classify(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Task with ID');
      expect(getAllErrorOutput()).toContain('not found');
    });
  });

  // -----------------------------------------------------------------------
  // Chatroom not found
  // -----------------------------------------------------------------------
  describe('chatroom not found', () => {
    it('exits with code 1 when chatroom does not exist', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await classify(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Chatroom not found');
    });
  });

  // -----------------------------------------------------------------------
  // Classification failure
  // -----------------------------------------------------------------------
  describe('classification failure', () => {
    it('exits with code 1 when classification mutation fails', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        teamEntryPoint: 'planner',
        teamRoles: ['planner', 'builder'],
      });
      // Classification fails
      (deps.backend.mutation as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Classification failed'));

      await classify(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to acknowledge task');
      expect(getAllErrorOutput()).toContain('Classification failed');
    });
  });
});
