/**
 * Messages Unit Tests
 *
 * Tests the messages commands using injected dependencies.
 * Covers: auth validation, successful list calls, query failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessagesDeps } from './deps.js';
import {
  listBySenderRole,
  listSinceMessage,
  type ListBySenderRoleOptions,
  type ListSinceMessageOptions,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';
const TEST_MESSAGE_ID = 'msg_abc123_test_message_1';

const MOCK_MESSAGE = {
  _id: 'msg_test123' as const,
  _creationTime: Date.now(),
  type: 'text' as const,
  content: 'Hello world',
  senderRole: 'user',
  targetRole: null as string | null,
  chatroomId: TEST_CHATROOM_ID,
  classification: null as string | null,
  taskStatus: null as string | null,
  featureTitle: null as string | null,
};

function createMockDeps(overrides?: Partial<MessagesDeps>): MessagesDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([MOCK_MESSAGE]),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  };
}

function listBySenderRoleOptions(
  overrides?: Partial<ListBySenderRoleOptions>
): ListBySenderRoleOptions {
  return {
    role: 'builder',
    senderRole: 'user',
    limit: 10,
    ...overrides,
  };
}

function listSinceMessageOptions(
  overrides?: Partial<ListSinceMessageOptions>
): ListSinceMessageOptions {
  return {
    role: 'builder',
    sinceMessageId: TEST_MESSAGE_ID,
    limit: 100,
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

describe('listBySenderRole', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await listBySenderRole(TEST_CHATROOM_ID, listBySenderRoleOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalled();
      const errOutput = getAllErrorOutput();
      expect(errOutput).toMatch(/Not authenticated/);
    });
  });

  describe('successful list', () => {
    it('calls listBySenderRole query and logs messages', async () => {
      const deps = createMockDeps();

      await listBySenderRole(TEST_CHATROOM_ID, listBySenderRoleOptions(), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.query).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Messages from user');
      expect(output).toContain('Hello world');
    });
  });

  describe('error handling', () => {
    it('exits with code 1 when query fails', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection refused')
      );

      await listBySenderRole(TEST_CHATROOM_ID, listBySenderRoleOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Error fetching messages');
      expect(getAllErrorOutput()).toContain('Connection refused');
    });
  });
});

describe('listSinceMessage', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await listSinceMessage(TEST_CHATROOM_ID, listSinceMessageOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalled();
      const errOutput = getAllErrorOutput();
      expect(errOutput).toMatch(/Not authenticated/);
    });
  });

  describe('successful list', () => {
    it('calls listSinceMessage query and logs messages', async () => {
      const deps = createMockDeps();

      await listSinceMessage(TEST_CHATROOM_ID, listSinceMessageOptions(), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.query).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Messages since');
      expect(output).toContain(TEST_MESSAGE_ID);
      expect(output).toContain('Hello world');
    });
  });

  describe('error handling', () => {
    it('exits with code 1 when query fails', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network timeout')
      );

      await listSinceMessage(TEST_CHATROOM_ID, listSinceMessageOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Error fetching messages');
      expect(getAllErrorOutput()).toContain('Network timeout');
    });
  });
});
