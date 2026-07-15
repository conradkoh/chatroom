import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgenticQueryHarnessSelection } from './useAgenticQueryHarnessSelection';

let mockCapabilities: {
  machineId: string | null;
  harnesses: {
    name: string;
    providers: {
      providerID: string;
      name: string;
      models: { modelID: string; name: string }[];
    }[];
  }[];
} = {
  machineId: null,
  harnesses: [],
};

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_api: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    return mockCapabilities;
  },
  useSessionMutation: () => vi.fn(),
}));

vi.mock('@/modules/chatroom/direct-harness/hooks/useHarnessModelFilter', () => ({
  useHarnessModelFilter: () => ({
    isHidden: undefined,
    setFilter: vi.fn(),
  }),
}));

describe('useAgenticQueryHarnessSelection', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCapabilities = {
      machineId: 'machine-1',
      harnesses: [
        {
          name: 'opencode-sdk',
          providers: [
            {
              providerID: 'openai',
              name: 'OpenAI',
              models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }],
            },
          ],
        },
      ],
    };
  });

  it('returns harness and model selection ready for submit', async () => {
    const { result } = renderHook(() => useAgenticQueryHarnessSelection('ws-1'));

    await waitFor(() => {
      expect(result.current.selectionReady).toBe(true);
    });

    expect(result.current.harnessName).toBe('opencode-sdk');
    expect(result.current.toSubmitSelection()).toEqual({
      harnessName: 'opencode-sdk',
      model: { providerID: 'openai', modelID: 'gpt-4o' },
    });
  });

  it('persists selection per workspace in localStorage', async () => {
    const { result, rerender } = renderHook(() => useAgenticQueryHarnessSelection('ws-1'));

    await waitFor(() => {
      expect(result.current.selectionReady).toBe(true);
    });

    rerender();

    const stored = JSON.parse(localStorage.getItem('agentic-query-harness:ws-1') ?? '{}');
    expect(stored.harnessName).toBe('opencode-sdk');
    expect(stored.modelKey).toBe('openai::gpt-4o');
  });
});
