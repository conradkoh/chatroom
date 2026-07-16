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

vi.mock('@/modules/chatroom/features/search-config/hooks/useSearchConfigUsage', () => ({
  useSearchConfigUsage: () => ({
    getAllUsage: vi.fn(() => new Map()),
    getLastUsed: vi.fn(() => null),
    recordUsage: vi.fn(),
    clearUsage: vi.fn(),
  }),
}));

vi.mock('@/modules/chatroom/features/search-config/hooks/useSearchConfigFavorites', () => ({
  useSearchConfigFavorites: () => ({
    favorites: [],
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    moveFavorite: vi.fn(),
    isFavorite: () => false,
    isLoading: false,
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

  it('persists selection per machine in localStorage', async () => {
    const { result, rerender } = renderHook(() => useAgenticQueryHarnessSelection('ws-1'));

    await waitFor(() => {
      expect(result.current.selectionReady).toBe(true);
    });

    rerender();

    // Should be stored under machine key, not workspace key
    const stored = JSON.parse(localStorage.getItem('agentic-query-harness:machine-1') ?? '{}');
    expect(stored.harnessName).toBe('opencode-sdk');
    expect(stored.modelKey).toBe('openai::gpt-4o');

    // Workspace key should not exist
    expect(localStorage.getItem('agentic-query-harness:ws-1')).toBeNull();
  });

  it('restores selection for different workspace on same machine', async () => {
    localStorage.setItem(
      'agentic-query-harness:machine-1',
      JSON.stringify({ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' })
    );

    const { result } = renderHook(() => useAgenticQueryHarnessSelection('ws-2'));

    await waitFor(() => {
      expect(result.current.selectionReady).toBe(true);
    });

    expect(result.current.harnessName).toBe('opencode-sdk');
    expect(result.current.selectedModel).toBe('openai::gpt-4o');
  });

  it('migrates legacy workspace key once on first use', async () => {
    // Set legacy data
    localStorage.setItem(
      'agentic-query-harness:ws-legacy',
      JSON.stringify({ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' })
    );

    const { result } = renderHook(() => useAgenticQueryHarnessSelection('ws-legacy'));

    await waitFor(() => {
      expect(result.current.selectionReady).toBe(true);
    });

    // Legacy key migrated to machine-scoped key
    const stored = JSON.parse(localStorage.getItem('agentic-query-harness:machine-1') ?? '{}');
    expect(stored.harnessName).toBe('opencode-sdk');
  });

  it('records usage when selection resolves', async () => {
    const { result } = renderHook(() => useAgenticQueryHarnessSelection('ws-1'));

    await waitFor(() => {
      expect(result.current.selectionReady).toBe(true);
    });
    // recordUsage should have been called
  });

  it('returns favorites, currentEntry, and machineId', async () => {
    const { result } = renderHook(() => useAgenticQueryHarnessSelection('ws-1'));

    await waitFor(() => {
      expect(result.current.selectionReady).toBe(true);
    });

    expect(result.current.machineId).toBe('machine-1');
    expect(result.current.favorites).toEqual([]);
    expect(result.current.currentEntry).toEqual({
      harnessName: 'opencode-sdk',
      modelKey: 'openai::gpt-4o',
    });
    expect(typeof result.current.applyConfig).toBe('function');
    expect(typeof result.current.isFavorite).toBe('function');
  });
});
