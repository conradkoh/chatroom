/**
 * GetNextTaskSession Unit Tests
 *
 * Tests each subscription response type handler to verify:
 * - Correct exit codes
 * - Event logging via logAndExit
 * - Reconnection guidance printed on non-task exits
 * - Duplicate processing guards
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type SessionParams, GetNextTaskSession } from './session.js';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

// Mock getConvexWsClient so subscribe() doesn't need a real Convex connection
vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test:3210',
  getConvexClient: vi.fn(),
  getConvexWsClient: vi.fn(),
}));

// Mock getNextTaskCommand to return a predictable string
vi.mock('@workspace/backend/prompts/cli/get-next-task/command.js', () => ({
  getNextTaskCommand: (opts: { chatroomId: string; role: string; cliEnvPrefix: string }) =>
    `${opts.cliEnvPrefix}chatroom get-next-task --chatroom-id=${opts.chatroomId} --role=${opts.role}`,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Captured subscription callbacks from wsClient.onUpdate */
type SubscriptionCallbacks = {
  onUpdate: (response: unknown) => void;
  onError: (error: Error) => void;
};

let subscriptionCallbacks: SubscriptionCallbacks | null = null;

/** Build a mock Convex HTTP client with spied mutation/query methods. */
function createMockClient() {
  return {
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(undefined),
  };
}

/** Build default SessionParams for testing. */
function createSessionParams(
  overrides?: Partial<SessionParams>
): SessionParams & { client: ReturnType<typeof createMockClient> } {
  const client = createMockClient();
  return {
    chatroomId: 'test_chatroom_id_12345678',
    role: 'builder',
    silent: false,
    sessionId: 'test-session-id' as unknown as SessionParams['sessionId'],
    connectionId: 'test-connection-id',
    cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://test:3210 ',
    client: client as unknown as SessionParams['client'],
    ...overrides,
  } as SessionParams & { client: ReturnType<typeof createMockClient> };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitSpy: any;

let logSpy: any;

let _errorSpy: any;

let _warnSpy: any;

// Track original max listeners to restore later
const originalMaxListeners = process.getMaxListeners();

beforeEach(async () => {
  subscriptionCallbacks = null;

  // Increase max listeners to avoid warnings from signal handler registration in tests
  process.setMaxListeners(50);

  // Mock process.exit to be a no-op (capture calls without actually exiting)
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

  // Capture console output
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  _errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  _warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  // Configure getConvexWsClient to return a mock that captures callbacks
  const { getConvexWsClient } = await import('../../infrastructure/convex/client.js');
  (getConvexWsClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    onUpdate: (
      _query: unknown,
      _args: unknown,
      onUpdate: (response: unknown) => void,
      onError: (error: Error) => void
    ) => {
      subscriptionCallbacks = { onUpdate, onError };
      return () => {}; // unsubscribe
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.setMaxListeners(originalMaxListeners);
});

// ---------------------------------------------------------------------------
// Helper: start a session and get access to subscription callbacks
// ---------------------------------------------------------------------------

async function startSession(overrides?: Partial<SessionParams>) {
  const params = createSessionParams(overrides);
  const session = new GetNextTaskSession(params);

  await session.start();

  if (!subscriptionCallbacks) {
    throw new Error('Subscription callbacks were not captured — mock not set up correctly');
  }

  return { session, params, callbacks: subscriptionCallbacks };
}

/** Helper to collect all console.log output as a single string */
function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GetNextTaskSession', () => {
  // -----------------------------------------------------------------------
  // no_tasks
  // -----------------------------------------------------------------------
  describe('no_tasks response', () => {
    it('does NOT exit — continues waiting', async () => {
      const { callbacks } = await startSession();

      callbacks.onUpdate({ type: 'no_tasks' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // superseded
  // -----------------------------------------------------------------------
  describe('superseded response', () => {
    it('exits with code 0 and logs the event', async () => {
      const { callbacks } = await startSession();

      callbacks.onUpdate({
        type: 'superseded',
        newConnectionId: 'new-conn-123',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).toHaveBeenCalledWith(0);

      const output = getAllLogOutput();
      expect(output).toContain('[EVENT: superseded]');
      expect(output).toContain('Another get-next-task process started');
      expect(output).toContain('To reconnect, run:');
      expect(output).toContain('chatroom get-next-task');
    });
  });

  // -----------------------------------------------------------------------
  // grace_period
  // -----------------------------------------------------------------------
  describe('grace_period response', () => {
    it('exits with code 0 and logs task ID and remaining time', async () => {
      const { callbacks } = await startSession();

      callbacks.onUpdate({
        type: 'grace_period',
        taskId: 'task_abc123',
        remainingMs: 15000,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).toHaveBeenCalledWith(0);

      const output = getAllLogOutput();
      expect(output).toContain('[EVENT: grace_period]');
      expect(output).toContain('task_abc123');
      expect(output).toContain('15s grace remaining');
      expect(output).toContain('To reconnect, run:');
    });
  });

  // -----------------------------------------------------------------------
  // reconnect
  // -----------------------------------------------------------------------
  describe('reconnect response', () => {
    it('exits with code 0 and logs the reason', async () => {
      const { callbacks } = await startSession();

      callbacks.onUpdate({
        type: 'reconnect',
        reason: 'Server maintenance',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).toHaveBeenCalledWith(0);

      const output = getAllLogOutput();
      expect(output).toContain('[EVENT: reconnect]');
      expect(output).toContain('Server maintenance');
      expect(output).toContain('To reconnect, run:');
    });
  });

  // -----------------------------------------------------------------------
  // error (fatal)
  // -----------------------------------------------------------------------
  describe('error (fatal) response', () => {
    it('exits with code 1 and logs the error', async () => {
      const { callbacks } = await startSession();

      callbacks.onUpdate({
        type: 'error',
        code: 'PARTICIPANT_NOT_FOUND',
        message: 'Participant not found in chatroom',
        fatal: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).toHaveBeenCalledWith(1);

      const output = getAllLogOutput();
      expect(output).toContain('[EVENT: error (fatal)]');
      expect(output).toContain('PARTICIPANT_NOT_FOUND');
      expect(output).toContain('FATAL ERROR');
      expect(output).toContain('To reconnect, run:');
    });
  });

  // -----------------------------------------------------------------------
  // error (non-fatal)
  // -----------------------------------------------------------------------
  describe('error (non-fatal) response', () => {
    it('exits with code 0 and logs the error', async () => {
      const { callbacks } = await startSession();

      callbacks.onUpdate({
        type: 'error',
        code: 'PARTICIPANT_NOT_FOUND',
        message: 'Transient issue',
        fatal: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).toHaveBeenCalledWith(0);

      const output = getAllLogOutput();
      expect(output).toContain('[EVENT: error (non-fatal)]');
      expect(output).toContain('Non-fatal error');
      expect(output).toContain('To reconnect, run:');
    });
  });

  // -----------------------------------------------------------------------
  // tasks — successful delivery
  // -----------------------------------------------------------------------
  describe('tasks response (success)', () => {
    it('claims task, delivers prompt, exits with code 0', async () => {
      const { callbacks, params } = await startSession();

      params.client.query.mockResolvedValue({
        fullCliOutput: 'Task delivery output here',
      });

      callbacks.onUpdate({
        type: 'tasks',
        tasks: [
          {
            task: { _id: 'task_123' as any, status: 'pending' },
            message: { _id: 'msg_456' as any },
          },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(exitSpy).toHaveBeenCalledWith(0);

      // Verify claimTask was called (it's the first mutation call for pending tasks)
      expect(params.client.mutation).toHaveBeenCalled();

      const output = getAllLogOutput();
      expect(output).toContain('📨 Task received!');
      expect(output).toContain('Task delivery output here');
    });

    it('skips claim for acknowledged tasks', async () => {
      const { callbacks, params } = await startSession();

      params.client.query.mockResolvedValue({
        fullCliOutput: 'Acknowledged task output',
      });

      callbacks.onUpdate({
        type: 'tasks',
        tasks: [
          {
            task: { _id: 'task_789' as any, status: 'acknowledged' },
            message: null,
          },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(exitSpy).toHaveBeenCalledWith(0);

      const output = getAllLogOutput();
      expect(output).toContain('📨 Task received!');
      expect(output).toContain('Acknowledged task output');

      // For acknowledged tasks, claimTask and claimMessage should NOT be called.
      // No mutation calls expected — task is already acknowledged, no claiming needed.
      expect(params.client.mutation).toHaveBeenCalledTimes(0);
    });

    it('does not process duplicate tasks', async () => {
      const { callbacks, params } = await startSession();

      params.client.query.mockResolvedValue({
        fullCliOutput: 'First task output',
      });

      // First task
      callbacks.onUpdate({
        type: 'tasks',
        tasks: [
          {
            task: { _id: 'task_first' as any, status: 'pending' },
            message: null,
          },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(exitSpy).toHaveBeenCalledWith(0);

      // Reset spy to check second invocation
      exitSpy.mockClear();

      // Second task — should be ignored (taskProcessed = true)
      callbacks.onUpdate({
        type: 'tasks',
        tasks: [
          {
            task: { _id: 'task_second' as any, status: 'pending' },
            message: null,
          },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // process.exit should NOT be called again
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // tasks — delivery failure
  // -----------------------------------------------------------------------
  describe('tasks response (delivery failure)', () => {
    it('exits with code 1 via logAndExit when delivery fails', async () => {
      const { callbacks, params } = await startSession();

      // Make the query fail after task is claimed
      params.client.query.mockRejectedValue(new Error('Network timeout'));

      callbacks.onUpdate({
        type: 'tasks',
        tasks: [
          {
            task: { _id: 'task_fail' as any, status: 'pending' },
            message: null,
          },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(exitSpy).toHaveBeenCalledWith(1);

      const output = getAllLogOutput();
      expect(output).toContain('[EVENT: task_delivery_failed]');
      expect(output).toContain('Network timeout');
      expect(output).toContain('To reconnect, run:');
    });
  });

  // -----------------------------------------------------------------------
  // tasks — empty tasks array
  // -----------------------------------------------------------------------
  describe('tasks response (empty array)', () => {
    it('does nothing when tasks array is empty', async () => {
      const { callbacks } = await startSession();

      callbacks.onUpdate({
        type: 'tasks',
        tasks: [],
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup on exit
  // -----------------------------------------------------------------------
  describe('cleanup', () => {
    it('calls participants.leave on exit for non-task events', async () => {
      const { callbacks, params } = await startSession();

      callbacks.onUpdate({ type: 'reconnect', reason: 'cleanup test' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).toHaveBeenCalledWith(0);

      // cleanup() is called fire-and-forget by logAndExit
      // It calls participants.leave mutation
      expect(params.client.mutation).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Reconnection guidance
  // -----------------------------------------------------------------------
  describe('reconnection guidance', () => {
    it('includes chatroom ID and role in reconnect command', async () => {
      const { callbacks } = await startSession({
        chatroomId: 'my_custom_chatroom_id_1234',
        role: 'reviewer',
      });

      callbacks.onUpdate({ type: 'superseded', newConnectionId: 'new' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitSpy).toHaveBeenCalledWith(0);

      const output = getAllLogOutput();
      expect(output).toContain('--chatroom-id=my_custom_chatroom_id_1234');
      expect(output).toContain('--role=reviewer');
    });
  });
});
