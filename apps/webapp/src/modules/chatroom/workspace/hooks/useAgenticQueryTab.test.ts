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

  it('creates a search draft and opens the tab', async () => {
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

  it('calls onFocusRequest and not createDraft when active tab is agentic-query', async () => {
    const onFocusRequest = vi.fn();
    const onBeforeOpen = vi.fn();
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
      useAgenticQueryTabOpener('workspace-1', fileTabs, { onFocusRequest, onBeforeOpen })
    );

    await act(async () => {
      await result.current.openTab();
    });

    expect(onBeforeOpen).toHaveBeenCalled();
    expect(onFocusRequest).toHaveBeenCalled();
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(fileTabs.openAgenticQueryTab).not.toHaveBeenCalled();
  });

  it('activates reusable draft without creating new one', async () => {
    const onFocusRequest = vi.fn();
    const onBeforeOpen = vi.fn();
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
      useAgenticQueryTabOpener('workspace-1', fileTabs, { onFocusRequest, onBeforeOpen })
    );

    await act(async () => {
      await result.current.openTab();
    });

    expect(onBeforeOpen).toHaveBeenCalled();
    expect(onFocusRequest).toHaveBeenCalled();
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(fileTabs.openAgenticQueryTab).toHaveBeenCalledWith(
      'reusable-1',
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

  it('reuses draft with Agentic Search title and normalizes legacy ask tabs to search', async () => {
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
      activeTabKey: 'a.ts',
    });
    const { result } = renderHook(() => useAgenticQueryTabOpener('workspace-1', fileTabs));

    await act(async () => {
      await result.current.openTab();
    });

    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(fileTabs.openAgenticQueryTab).toHaveBeenCalledWith(
      'reusable-ask',
      'search',
      'Agentic Search'
    );
  });
});
