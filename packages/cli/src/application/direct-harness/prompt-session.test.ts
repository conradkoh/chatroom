import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promptSession } from './prompt-session.js';
import type { PromptSessionDeps, PromptSessionOptions } from './prompt-session.js';
import type { HarnessSessionId } from '../../domain/direct-harness/index.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../api.js', () => ({
  api: {
    chatroom: {
      directHarness: {
        sessions: {
          getSession: 'mock-getSession',
        },
        prompts: {
          completePendingPrompt: 'mock-completePendingPrompt',
        },
      },
    },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockSession(agent = 'builder', harnessSessionId = 'harness-session-abc') {
  return {
    agent,
    harnessSessionId,
    status: 'active',
    harnessSessionRowId: 'row-123',
    workspaceId: 'ws-1',
    harnessName: 'opencode-sdk',
    createdAt: 0,
    lastActiveAt: 0,
    createdBy: 'user-1',
    _id: 'row-123',
    _creationTime: 0,
  };
}

function createDeps(overrides: Partial<PromptSessionDeps> = {}): PromptSessionDeps & {
  mutationFn: ReturnType<typeof vi.fn>;
  queryFn: ReturnType<typeof vi.fn>;
  promptFn: ReturnType<typeof vi.fn>;
} {
  const mutationFn = vi.fn().mockResolvedValue(null);
  const queryFn = vi.fn().mockResolvedValue(createMockSession());
  const promptFn = vi.fn().mockResolvedValue(undefined);

  return {
    backend: { mutation: mutationFn, query: queryFn },
    sessionId: 'test-session',
    machineId: 'test-machine',
    prompt: promptFn,
    ...overrides,
    mutationFn,
    queryFn,
    promptFn,
  };
}

const VALID_OPTIONS: PromptSessionOptions = {
  harnessSessionRowId: 'row-123',
  promptId: 'prompt-456',
  parts: [{ type: 'text' as const, text: 'hello' }],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('promptSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads session fresh from the backend on each call', async () => {
    const deps = createDeps();
    await promptSession(deps, VALID_OPTIONS);
    expect(deps.queryFn).toHaveBeenCalledWith('mock-getSession', expect.objectContaining({
      harnessSessionRowId: 'row-123',
    }));
  });

  it('calls harness.prompt with the current agent (from fresh session read)', async () => {
    const deps = createDeps();
    // Session has agent 'builder'
    await promptSession(deps, VALID_OPTIONS);
    expect(deps.promptFn).toHaveBeenCalledWith(
      'harness-session-abc' as HarnessSessionId,
      expect.objectContaining({ agent: 'builder', parts: VALID_OPTIONS.parts })
    );
  });

  it('uses updated agent after updateSessionAgent (mid-switch test)', async () => {
    const deps = createDeps();
    // Simulate agent switch: first call returns 'builder', second returns 'planner'
    deps.queryFn
      .mockResolvedValueOnce(createMockSession('planner', 'harness-session-abc'));

    await promptSession(deps, VALID_OPTIONS);

    expect(deps.promptFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agent: 'planner' })
    );
  });

  it('marks prompt as done on success', async () => {
    const deps = createDeps();
    await promptSession(deps, VALID_OPTIONS);

    const callOrder = deps.mutationFn.mock.calls.map((c: any[]) => c[0]);
    expect(callOrder).toContain('mock-completePendingPrompt');
    const completeCall = deps.mutationFn.mock.calls.find((c: any[]) => c[0] === 'mock-completePendingPrompt');
    expect(completeCall?.[1]?.status).toBe('done');
  });

  it('marks prompt as error when harness.prompt throws', async () => {
    const deps = createDeps({
      prompt: vi.fn().mockRejectedValue(new Error('connection reset')),
    });

    await expect(promptSession(deps, VALID_OPTIONS)).rejects.toThrow('connection reset');

    const completeCall = deps.mutationFn.mock.calls.find((c: any[]) => c[0] === 'mock-completePendingPrompt');
    expect(completeCall?.[1]?.status).toBe('error');
    expect(completeCall?.[1]?.errorMessage).toBe('connection reset');
  });

  it('marks prompt as error when session has no harnessSessionId', async () => {
    const deps = createDeps();
    deps.queryFn.mockResolvedValue({
      ...createMockSession(),
      harnessSessionId: undefined,
    });

    await promptSession(deps, VALID_OPTIONS);

    // Should not call harness.prompt
    expect(deps.promptFn).not.toHaveBeenCalled();
    // Should complete with error
    const completeCall = deps.mutationFn.mock.calls.find((c: any[]) => c[0] === 'mock-completePendingPrompt');
    expect(completeCall?.[1]?.status).toBe('error');
  });
});
