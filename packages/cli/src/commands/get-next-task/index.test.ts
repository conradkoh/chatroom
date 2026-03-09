/**
 * get-next-task index Unit Tests
 *
 * Tests that `get-next-task` does NOT call `updateAgentConfig`.
 * Agent harness configuration is now owned exclusively by `startAgent`/daemon,
 * not by the per-task `get-next-task` command.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock infrastructure modules
// ---------------------------------------------------------------------------

const mockMutation = vi.fn();
const mockQuery = vi.fn();

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://127.0.0.1:3210',
  getConvexClient: vi.fn().mockResolvedValue({
    mutation: mockMutation,
    query: mockQuery,
  }),
  getConvexWsClient: vi.fn(),
}));

vi.mock('../../infrastructure/auth/storage.js', () => ({
  getSessionId: vi.fn().mockReturnValue('test-session-id'),
  getOtherSessionUrls: vi.fn().mockReturnValue([]),
}));

vi.mock('./session.js', () => ({
  GetNextTaskSession: class {
    start = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../api.js', () => ({
  api: {
    machines: {
      register: 'machines:register',
      updateAgentConfig: 'machines:updateAgentConfig',
      getTeamAgentConfigs: 'machines:getTeamAgentConfigs',
    },
    chatrooms: {
      get: 'chatrooms:get',
    },
    participants: {
      join: 'participants:join',
      getByRole: 'participants:getByRole',
    },
    messages: {
      getTaskDeliveryPrompt: 'messages:getTaskDeliveryPrompt',
      getInitPrompt: 'messages:getInitPrompt',
    },
  },
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'jx750h696te75x67z5q6cbwkph7zvm2x';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get-next-task — agent config ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Happy-path query responses
    mockQuery.mockImplementation(async (queryFn: string) => {
      if (queryFn === 'chatrooms:get') {
        return {
          _id: TEST_CHATROOM_ID,
          teamName: 'Test Team',
          teamRoles: ['builder', 'reviewer'],
          teamEntryPoint: 'builder',
        };
      }
      if (queryFn === 'participants:getByRole') {
        return { role: 'builder', chatroomId: TEST_CHATROOM_ID };
      }
      if (queryFn === 'machines:getTeamAgentConfigs') {
        return [];
      }
      return undefined;
    });

    mockMutation.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints foreground warning after connecting when not silent', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQuery.mockImplementation(async (queryFn: string) => {
      if (queryFn === 'chatrooms:get') {
        return { _id: TEST_CHATROOM_ID, teamName: 'Test', teamRoles: ['builder'], teamEntryPoint: 'builder' };
      }
      if (queryFn === 'machines:getTeamAgentConfigs') return [];
      if (queryFn === 'messages:getInitPrompt') {
        return { prompt: 'init prompt text', hasSystemPromptControl: true };
      }
      return undefined;
    });

    const { getNextTask } = await import('./index.js');

    await getNextTask(TEST_CHATROOM_ID, { role: 'builder' }).catch(() => {});

    const allOutput = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allOutput).toContain('FOREGROUND');
    expect(allOutput).toContain('background');
    expect(allOutput).toContain('terminate and restart');

    consoleSpy.mockRestore();
  });

  it('should NEVER call updateAgentConfig — agent config is owned by startAgent, not get-next-task', async () => {
    // Agent harness configuration (agentType, workingDir) is now written exclusively
    // by the startAgent/daemon flow. get-next-task only registers the machine presence
    // (machines:register) and joins the participant — it does NOT touch agentType config.

    const { getNextTask } = await import('./index.js');

    await getNextTask(TEST_CHATROOM_ID, {
      role: 'builder',
      silent: true,
    }).catch(() => {
      // Session errors are expected and irrelevant to this assertion
    });

    const updateAgentConfigCalls = mockMutation.mock.calls.filter(
      ([fn]) => fn === 'machines:updateAgentConfig'
    );

    expect(
      updateAgentConfigCalls.length,
      'updateAgentConfig must never be called from get-next-task'
    ).toBe(0);
  });
});
