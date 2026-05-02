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
    lastUsedConfig: { agent },
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
    sessionId: 'test-session' as any,
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
  override: { agent: 'builder' },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('promptSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads session fresh from the backend on each call', async () => {
    const deps = createDeps();
    await promptSession(deps, VALID_OPTIONS);
    expect(deps.queryFn).toHaveBeenCalledWith(
      'mock-getSession',
      expect.objectContaining({
        harnessSessionRowId: 'row-123',
      })
    );
  });

  it('calls harness.prompt with override.agent (not from session lastUsedConfig)', async () => {
    const deps = createDeps();
    // Session has agent 'builder' in lastUsedConfig, but override says 'planner'
    const options: PromptSessionOptions = {
      ...VALID_OPTIONS,
      override: { agent: 'planner' },
    };
    await promptSession(deps, options);
    expect(deps.promptFn).toHaveBeenCalledWith(
      'harness-session-abc' as HarnessSessionId,
      expect.objectContaining({ agent: 'planner', parts: options.parts })
    );
  });

  it('passes model, system, tools from override to harness.prompt', async () => {
    const deps = createDeps();
    const override = {
      agent: 'builder',
      model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
      system: 'You are a helpful assistant',
      tools: { bash: true, editor: false },
    };
    await promptSession(deps, { ...VALID_OPTIONS, override });
    expect(deps.promptFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agent: 'builder',
        model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
        system: 'You are a helpful assistant',
        tools: { bash: true, editor: false },
      })
    );
  });

  it('throws and does NOT call harness.prompt when override.agent is empty', async () => {
    const deps = createDeps();
    const options: PromptSessionOptions = {
      ...VALID_OPTIONS,
      override: { agent: '' },
    };
    await expect(promptSession(deps, options)).rejects.toThrow(/override\.agent is required/);
    expect(deps.promptFn).not.toHaveBeenCalled();
  });

  it('marks prompt as done on success', async () => {
    const deps = createDeps();
    await promptSession(deps, VALID_OPTIONS);

    const callOrder = deps.mutationFn.mock.calls.map((c: any[]) => c[0]);
    expect(callOrder).toContain('mock-completePendingPrompt');
    const completeCall = deps.mutationFn.mock.calls.find(
      (c: any[]) => c[0] === 'mock-completePendingPrompt'
    );
    expect(completeCall?.[1]?.status).toBe('done');
  });

  it('marks prompt as error when harness.prompt throws', async () => {
    const deps = createDeps({
      prompt: vi.fn().mockRejectedValue(new Error('connection reset')),
    });

    await expect(promptSession(deps, VALID_OPTIONS)).rejects.toThrow('connection reset');

    const completeCall = deps.mutationFn.mock.calls.find(
      (c: any[]) => c[0] === 'mock-completePendingPrompt'
    );
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
    const completeCall = deps.mutationFn.mock.calls.find(
      (c: any[]) => c[0] === 'mock-completePendingPrompt'
    );
    expect(completeCall?.[1]?.status).toBe('error');
  });
});
