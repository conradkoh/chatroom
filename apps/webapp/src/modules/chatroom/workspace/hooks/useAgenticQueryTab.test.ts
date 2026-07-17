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

function createFileTabsMock(overrides?: Partial<UseFileTabsReturn>): UseFileTabsReturn {
  return {
    tabs: [],
    activeTabKey: null,
    openAgenticQueryTab: vi.fn(),
    ...overrides,
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
      await result.current.openTab();
    });

    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(fileTabs.openAgenticQueryTab).not.toHaveBeenCalled();
  });

  it('creates a search draft and opens the tab on first open', async () => {
    const fileTabs = createFileTabsMock();
    const { result } = renderHook(() => useAgenticQueryTabOpener('workspace-1', fileTabs));

    await act(async () => {
      await result.current.openTab();
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

  it('calls onBeforeOpen when creating a new draft', async () => {
    const onBeforeOpen = vi.fn();
    const fileTabs = createFileTabsMock();
    const { result } = renderHook(() =>
      useAgenticQueryTabOpener('workspace-1', fileTabs, { onBeforeOpen })
    );

    await act(async () => {
      await result.current.openTab();
    });

    expect(onBeforeOpen).toHaveBeenCalled();
  });

  describe('Cmd+Shift+F concurrent sessions', () => {
    it('creates a new draft when the active tab is already agentic-query', async () => {
      mockCreateDraft.mockResolvedValue({ queryId: 'query-new' });
      const onFocusRequest = vi.fn();
      const fileTabs = createFileTabsMock({
        tabs: [
          {
            kind: 'agentic-query',
            queryId: 'existing',
            name: 'Agentic Search',
            mode: 'search',
            isPinned: true,
          },
        ],
        activeTabKey: 'agentic-query:existing',
      });
      const { result } = renderHook(() =>
        useAgenticQueryTabOpener('workspace-1', fileTabs, { onFocusRequest })
      );

      await act(async () => {
        await result.current.openTab();
      });

      expect(mockCreateDraft).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        mode: 'search',
      });
      expect(fileTabs.openAgenticQueryTab).toHaveBeenCalledWith(
        'query-new',
        'search',
        'Agentic Search'
      );
      expect(onFocusRequest).toHaveBeenCalled();
    });

    it('creates a new draft instead of reactivating a reusable Agentic Search tab', async () => {
      mockCreateDraft.mockResolvedValue({ queryId: 'query-new' });
      const onFocusRequest = vi.fn();
      const fileTabs = createFileTabsMock({
        tabs: [
          {
            kind: 'agentic-query',
            queryId: 'reusable-1',
            name: 'Agentic Search',
            mode: 'search',
            isPinned: true,
          },
          { kind: 'file', filePath: 'a.ts', name: 'a.ts', isPinned: true },
        ],
        activeTabKey: 'a.ts',
      });
      const { result } = renderHook(() =>
        useAgenticQueryTabOpener('workspace-1', fileTabs, { onFocusRequest })
      );

      await act(async () => {
        await result.current.openTab();
      });

      expect(mockCreateDraft).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        mode: 'search',
      });
      expect(fileTabs.openAgenticQueryTab).toHaveBeenCalledWith(
        'query-new',
        'search',
        'Agentic Search'
      );
      expect(fileTabs.openAgenticQueryTab).not.toHaveBeenCalledWith(
        'reusable-1',
        'search',
        'Agentic Search'
      );
      expect(onFocusRequest).toHaveBeenCalled();
    });

    it('creates a new draft when another Agentic Search tab exists in ask mode', async () => {
      mockCreateDraft.mockResolvedValue({ queryId: 'query-new' });
      const fileTabs = createFileTabsMock({
        tabs: [
          {
            kind: 'agentic-query',
            queryId: 'reusable-ask',
            name: 'Agentic Search',
            mode: 'ask',
            isPinned: true,
          },
        ],
        activeTabKey: 'agentic-query:reusable-ask',
      });
      const { result } = renderHook(() => useAgenticQueryTabOpener('workspace-1', fileTabs));

      await act(async () => {
        await result.current.openTab();
      });

      expect(mockCreateDraft).toHaveBeenCalled();
      expect(fileTabs.openAgenticQueryTab).toHaveBeenCalledWith(
        'query-new',
        'search',
        'Agentic Search'
      );
      expect(fileTabs.openAgenticQueryTab).not.toHaveBeenCalledWith(
        'reusable-ask',
        'search',
        'Agentic Search'
      );
    });

    it('spawns distinct tabs on repeated openTab calls (simulates multiple Cmd+Shift+F)', async () => {
      mockCreateDraft
        .mockResolvedValueOnce({ queryId: 'query-1' })
        .mockResolvedValueOnce({ queryId: 'query-2' });
      const fileTabs = createFileTabsMock();
      const { result } = renderHook(() => useAgenticQueryTabOpener('workspace-1', fileTabs));

      await act(async () => {
        await result.current.openTab();
      });
      await act(async () => {
        await result.current.openTab();
      });

      expect(mockCreateDraft).toHaveBeenCalledTimes(2);
      expect(fileTabs.openAgenticQueryTab).toHaveBeenNthCalledWith(
        1,
        'query-1',
        'search',
        'Agentic Search'
      );
      expect(fileTabs.openAgenticQueryTab).toHaveBeenNthCalledWith(
        2,
        'query-2',
        'search',
        'Agentic Search'
      );
    });
  });
});
