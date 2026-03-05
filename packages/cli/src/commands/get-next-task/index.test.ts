/**
 * get-next-task index Unit Tests
 *
 * Tests the agent harness preservation behavior in get-next-task.
 * Verifies that when --agent-type flag is NOT provided, the existing
 * agentType in chatroom_machineAgentConfigs is preserved (not overwritten
 * with the machine's first available harness).
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

vi.mock('../../infrastructure/machine/index.js', () => ({
  ensureMachineRegistered: vi.fn().mockReturnValue({
    machineId: 'machine_abc123',
    hostname: 'test-host',
    os: 'darwin',
    // Machine has two harnesses — the BUG would default to 'opencode' (first)
    availableHarnesses: ['opencode', 'pi'],
    harnessVersions: { opencode: '1.0.0', pi: '2.0.0' },
  }),
}));

vi.mock('../../infrastructure/services/remote-agents/opencode/index.js', () => ({
  OpenCodeAgentService: class {
    isInstalled = vi.fn().mockReturnValue(false);
    listModels = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock('../../infrastructure/services/remote-agents/pi/index.js', () => ({
  PiAgentService: class {
    isInstalled = vi.fn().mockReturnValue(false);
    listModels = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock('./session.js', () => ({
  GetNextTaskSession: class {
    start = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../api.js', () => ({
  api: {
    machines: {
      registerMachine: 'machines:registerMachine',
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
    },
  },
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'jx750h696te75x67z5q6cbwkph7zvm2x';
const TEST_MACHINE_ID = 'machine_abc123';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get-next-task — agent harness preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up successful query responses
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
        return { role: 'builder', chatroomId: TEST_CHATROOM_ID }; // already joined
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

  it('when --agent-type is NOT provided, updateAgentConfig should NOT receive a non-undefined agentType', async () => {
    // This test reproduces the bug:
    // BUG: code was `options.agentType ?? machineInfo.availableHarnesses[0]`
    //   → would pass 'opencode' even when --agent-type was not specified
    // FIX: only pass options.agentType, which is undefined when flag is absent
    //   → backend preserves existing agentType

    const { getNextTask } = await import('./index.js');

    await getNextTask(TEST_CHATROOM_ID, {
      role: 'builder',
      silent: true,
      // agentType is intentionally absent — user did NOT pass --agent-type
    }).catch(() => {
      // Errors from session startup are expected and don't affect this test
    });

    // Find any calls to updateAgentConfig
    const updateCalls = mockMutation.mock.calls.filter(
      ([fn]) => fn === 'machines:updateAgentConfig'
    );

    // If updateAgentConfig was called, agentType MUST be undefined
    // (backend preserves the existing user-selected harness)
    for (const [, args] of updateCalls) {
      expect(
        args.agentType,
        `updateAgentConfig was called with agentType='${args.agentType}' but it should be undefined when --agent-type is not provided`
      ).toBeUndefined();
    }

    // There should be exactly one updateAgentConfig call (to sync workingDir)
    expect(updateCalls.length).toBe(1);
  });

  it('when --agent-type IS explicitly provided, updateAgentConfig receives that agentType', async () => {
    const { getNextTask } = await import('./index.js');

    await getNextTask(TEST_CHATROOM_ID, {
      role: 'builder',
      silent: true,
      agentType: 'opencode', // explicitly specified by user
    }).catch(() => {
      // Errors from session startup are expected
    });

    const updateCalls = mockMutation.mock.calls.filter(
      ([fn]) => fn === 'machines:updateAgentConfig'
    );

    expect(updateCalls.length).toBe(1);
    const [, args] = updateCalls[0];
    expect(args.agentType).toBe('opencode');
    expect(args.machineId).toBe(TEST_MACHINE_ID);
  });
});
