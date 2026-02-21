/**
 * report-progress Unit Tests
 *
 * Tests the report-progress command using injected dependencies.
 * Covers: auth validation, successful report, mutation failure (ConvexError handling).
 */

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportProgressDeps } from './deps.js';
import { reportProgress, type ReportProgressOptions } from './index.js';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/prompts/utils/env.js', () => ({
  getCliEnvPrefix: () => 'CHATROOM_CONVEX_URL=http://test:3210 ',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';

function createMockDeps(overrides?: Partial<ReportProgressDeps>): ReportProgressDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({ success: true }),
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

function defaultOptions(overrides?: Partial<ReportProgressOptions>): ReportProgressOptions {
  return {
    role: 'builder',
    message: 'Progress update: step 1 complete',
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

describe('reportProgress', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await reportProgress(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('successful report', () => {
    it('calls reportProgress mutation and logs success', async () => {
      const deps = createMockDeps();
      const message = 'Building component X';

      await reportProgress(TEST_CHATROOM_ID, defaultOptions({ message }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      // reportProgress + participants.heartbeat
      expect(deps.backend.mutation).toHaveBeenCalledTimes(2);

      const output = getAllLogOutput();
      expect(output).toContain('Progress reported');
      expect(output).toContain(message);
    });
  });

  describe('mutation failure', () => {
    it('exits with code 1 when reportProgress throws generic error', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network timeout')
      );

      await reportProgress(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('Failed to report progress');
      expect(errOutput).toContain('Network timeout');
    });

    it('exits with code 1 and shows auth hint when ConvexError has AUTH_FAILED', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ConvexError({ code: 'AUTH_FAILED', message: 'Session expired' })
      );

      await reportProgress(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('Failed to report progress');
      expect(errOutput).toContain('Session expired');
      expect(errOutput).toContain('Try authenticating again');
    });
  });
});
