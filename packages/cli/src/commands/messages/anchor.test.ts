/**
 * Anchor unit tests — verifies `messages anchor` output and auth/query handling
 * with a mocked backend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anchorMessages, type AnchorMessagesOptions } from './anchor.js';
import type { MessagesDeps } from './deps.js';

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';
const LAST_MESSAGE_ID = 'msg_anchor_last_1234567';
const PRIOR_MESSAGE_ID = 'msg_anchor_prior_123456';

const MOCK_LAST_MESSAGE = {
  _id: LAST_MESSAGE_ID,
  _creationTime: Date.now(),
  type: 'message',
  content: 'Build the dashboard and ship it',
  senderRole: 'user',
  targetRole: null as string | null,
  chatroomId: TEST_CHATROOM_ID,
  taskStatus: null as string | null,
};

const MOCK_PRIOR_MESSAGE = {
  _id: PRIOR_MESSAGE_ID,
  _creationTime: Date.now() - 60_000,
  type: 'message',
  content: 'Please implement the chatroom timeline with pagination',
  senderRole: 'user',
  targetRole: null as string | null,
  chatroomId: TEST_CHATROOM_ID,
  taskStatus: null as string | null,
};

function createMockDeps(overrides?: Partial<MessagesDeps>): MessagesDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ last: MOCK_LAST_MESSAGE, prior: [MOCK_PRIOR_MESSAGE] }),
    },
    session: {
      getSessionId: vi.fn().mockResolvedValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function anchorOptions(overrides?: Partial<AnchorMessagesOptions>): AnchorMessagesOptions {
  return {
    role: 'planner',
    priorLimit: 3,
    ...overrides,
  };
}

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

describe('anchorMessages', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockResolvedValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockResolvedValue([]),
        },
      });

      await anchorMessages(TEST_CHATROOM_ID, anchorOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toMatch(/Not authenticated/);
    });
  });

  describe('successful anchor', () => {
    it('queries getLastUserMessage with priorLimit and prints last message id', async () => {
      const deps = createMockDeps();

      await anchorMessages(TEST_CHATROOM_ID, anchorOptions(), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.query).toHaveBeenCalledTimes(1);
      const [, args] = (deps.backend.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(args).toMatchObject({
        chatroomId: TEST_CHATROOM_ID,
        priorLimit: 3,
      });
      expect(args.sessionId).toBe(TEST_SESSION_ID);

      const output = getAllLogOutput();
      expect(output).toContain(LAST_MESSAGE_ID);
      expect(output).toContain('Build the dashboard and ship it');
    });

    it('prints prior user messages for terse follow-ups', async () => {
      const deps = createMockDeps();

      await anchorMessages(TEST_CHATROOM_ID, anchorOptions(), deps);

      const output = getAllLogOutput();
      expect(output).toContain('Prior user messages');
      expect(output).toContain(PRIOR_MESSAGE_ID);
      expect(output).toContain('chatroom timeline with pagination');
      expect(output).toContain('Terse follow-up');
    });

    it('prints the proof-of-verification download command with the exact since-message-id', async () => {
      const deps = createMockDeps();

      await anchorMessages(TEST_CHATROOM_ID, anchorOptions(), deps);

      const output = getAllLogOutput();
      expect(output).toContain('--since-message-id=' + LAST_MESSAGE_ID);
      expect(output).toContain('rg "handoff|Goal|Requirements"');
      expect(output).toContain('Proof of verification');
    });

    it('prints the context-before-anchor download hint', async () => {
      const deps = createMockDeps();

      await anchorMessages(TEST_CHATROOM_ID, anchorOptions(), deps);

      const output = getAllLogOutput();
      expect(output).toContain('For context before the anchor');
      expect(output).toContain('--format=linear --limit=200');
    });
  });

  describe('empty chatroom', () => {
    it('reports no user messages without exiting', async () => {
      const deps = createMockDeps({
        backend: {
          mutation: vi.fn().mockResolvedValue(undefined),
          query: vi.fn().mockResolvedValue({ last: null, prior: [] }),
        },
      });

      await anchorMessages(TEST_CHATROOM_ID, anchorOptions(), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(getAllLogOutput()).toContain('No user messages found');
    });
  });

  describe('error handling', () => {
    it('exits with code 1 when query fails', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection refused')
      );

      await anchorMessages(TEST_CHATROOM_ID, anchorOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Error fetching messages');
      expect(getAllErrorOutput()).toContain('Connection refused');
    });
  });
});
