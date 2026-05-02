import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useSubmitPrompt } from './useSubmitPrompt';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSubmitPromptMutation = vi.fn();
const mockUseSessionQuery = vi.fn();
const mockUseSessionMutation = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: (...args: unknown[]) => mockUseSessionMutation(...args),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroom: {
      directHarness: {
        sessions: { getSession: 'mock:getSession' },
        prompts: { submitPrompt: 'mock:submitPrompt' },
      },
    },
  },
}));

const SESSION_ROW_ID = 'sr1' as never;

const LAST_USED_CONFIG = {
  agent: 'test-agent',
  model: { providerID: 'openai', modelID: 'gpt-4o' },
};

describe('useSubmitPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionMutation.mockReturnValue(mockSubmitPromptMutation);
    mockSubmitPromptMutation.mockResolvedValue(undefined);
  });

  it('calls submitPrompt mutation with override equal to session.lastUsedConfig', async () => {
    mockUseSessionQuery.mockReturnValue({ lastUsedConfig: LAST_USED_CONFIG, status: 'active' });

    const { result } = renderHook(() => useSubmitPrompt({ harnessSessionRowId: SESSION_ROW_ID }));

    await act(async () => {
      await result.current.submit({ parts: [{ type: 'text', text: 'hello' }] });
    });

    expect(mockSubmitPromptMutation).toHaveBeenCalledWith({
      harnessSessionRowId: SESSION_ROW_ID,
      parts: [{ type: 'text', text: 'hello' }],
      override: LAST_USED_CONFIG,
    });
  });

  it('throws when session.lastUsedConfig is undefined', async () => {
    mockUseSessionQuery.mockReturnValue({ lastUsedConfig: undefined, status: 'active' });

    const { result } = renderHook(() => useSubmitPrompt({ harnessSessionRowId: SESSION_ROW_ID }));

    await expect(
      act(async () => {
        await result.current.submit({ parts: [{ type: 'text', text: 'hello' }] });
      })
    ).rejects.toThrow('useSubmitPrompt: session.lastUsedConfig is undefined');

    expect(mockSubmitPromptMutation).not.toHaveBeenCalled();
  });

  it('throws when session is null (not found)', async () => {
    mockUseSessionQuery.mockReturnValue(null);

    const { result } = renderHook(() => useSubmitPrompt({ harnessSessionRowId: SESSION_ROW_ID }));

    await expect(
      act(async () => {
        await result.current.submit({ parts: [{ type: 'text', text: 'hello' }] });
      })
    ).rejects.toThrow('useSubmitPrompt: session.lastUsedConfig is undefined');
  });

  it('isSubmitting is true during mutation and false after', async () => {
    mockUseSessionQuery.mockReturnValue({ lastUsedConfig: LAST_USED_CONFIG, status: 'active' });

    let resolvePromise!: () => void;
    const pendingPromise = new Promise<void>((res) => {
      resolvePromise = res;
    });
    mockSubmitPromptMutation.mockReturnValue(pendingPromise);

    const { result } = renderHook(() => useSubmitPrompt({ harnessSessionRowId: SESSION_ROW_ID }));

    expect(result.current.isSubmitting).toBe(false);

    act(() => {
      void result.current.submit({ parts: [{ type: 'text', text: 'hi' }] });
    });

    await act(async () => {
      // Allow state update to flush
      await Promise.resolve();
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolvePromise();
      await pendingPromise;
    });

    expect(result.current.isSubmitting).toBe(false);
  });
});
