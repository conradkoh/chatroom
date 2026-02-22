/**
 * handoff Unit Tests
 *
 * Tests the handoff command using injected dependencies.
 * Covers: auth validation, successful handoff, mutation failure,
 * handoff restriction (suggested target), artifact validation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandoffDeps } from './deps.js';
import { handoff, type HandoffOptions } from './index.js';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/prompts/base/cli/handoff/command.js', () => ({
  handoffCommand: (opts: { chatroomId: string; role: string; nextRole: string }) =>
    `chatroom handoff --chatroom-id=${opts.chatroomId} --role=${opts.role} --next-role=${opts.nextRole}`,
}));

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

function createMockDeps(overrides?: Partial<HandoffDeps>): HandoffDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({ success: true }),
      query: vi.fn().mockResolvedValue(true),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  };
}

function defaultOptions(overrides?: Partial<HandoffOptions>): HandoffOptions {
  return {
    role: 'planner',
    message: 'Task completed, handing off',
    nextRole: 'builder',
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

describe('handoff', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await handoff(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('successful handoff', () => {
    it('calls sendHandoff mutation and logs success', async () => {
      const deps = createMockDeps();

      await handoff(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      // sendHandoff only (heartbeat now fired by preAction hook, not handler)
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Task completed and handed off to builder');
      expect(output).toContain('Task completed, handing off');
      expect(output).toContain('wait-for-task');
    });
  });

  describe('handoff restriction', () => {
    it('exits with code 1 and shows suggested target', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: {
          message: 'Cannot hand off to user for new_feature tasks',
          suggestedTarget: 'builder',
        },
      });

      await handoff(TEST_CHATROOM_ID, defaultOptions({ nextRole: 'user' }), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);

      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('Cannot hand off to user');
      expect(errOutput).toContain('builder');
    });
  });

  describe('mutation failure', () => {
    it('exits with code 1 when sendHandoff throws', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network timeout')
      );

      await handoff(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);

      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('Handoff failed');
      expect(errOutput).toContain('Network timeout');
    });
  });

  describe('artifact validation', () => {
    it('exits with code 1 when artifacts are invalid', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await handoff(TEST_CHATROOM_ID, defaultOptions({ attachedArtifactIds: ['art_123'] }), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
