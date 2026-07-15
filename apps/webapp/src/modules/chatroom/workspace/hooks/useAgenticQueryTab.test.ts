import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgenticQueryTabOpener } from './useAgenticQueryTab';
import type { UseFileTabsReturn } from './useFileTabs';

const mockCreateDraft = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockCreateDraft,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    web: {
      agenticQuery: {
        index: {
          createDraft: 'createDraft',
        },
      },
    },
  },
}));

function createFileTabsMock(): UseFileTabsReturn {
  return {
    openAgenticQueryTab: vi.fn(),
  } as unknown as UseFileTabsReturn;
}

describe('useAgenticQueryTabOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDraft.mockResolvedValue({ queryId: 'query-123' });
  });

  it('does not call createDraft when workspaceId is undefined', async () => {
    const fileTabs = createFileTabsMock();
    const { result } = renderHook(() => useAgenticQueryTabOpener(undefined, fileTabs));

    await act(async () => {
      await result.current.openSearchTab();
    });

    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(fileTabs.openAgenticQueryTab).not.toHaveBeenCalled();
  });

  it('creates a search draft and opens the tab', async () => {
    const fileTabs = createFileTabsMock();
    const { result } = renderHook(() => useAgenticQueryTabOpener('workspace-1', fileTabs));

    await act(async () => {
      await result.current.openSearchTab();
    });

    expect(mockCreateDraft).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      mode: 'search',
    });
    expect(fileTabs.openAgenticQueryTab).toHaveBeenCalledWith(
      'query-123',
      'search',
      'Agentic Search'
    );
  });

  it('creates an ask draft and opens the tab', async () => {
    const fileTabs = createFileTabsMock();
    const { result } = renderHook(() => useAgenticQueryTabOpener('workspace-1', fileTabs));

    await act(async () => {
      await result.current.openAskTab();
    });

    expect(mockCreateDraft).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      mode: 'ask',
    });
    expect(fileTabs.openAgenticQueryTab).toHaveBeenCalledWith('query-123', 'ask', 'Agentic Ask');
  });
});
