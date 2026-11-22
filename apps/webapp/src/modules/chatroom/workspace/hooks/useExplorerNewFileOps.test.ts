import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useExplorerNewFileOps } from './useExplorerNewFileOps';
import type { UseFileTabsReturn } from './useFileTabs';

function makeFileTabs() {
  return {
    tabs: [],
    pinTab: vi.fn(),
    closeTab: vi.fn(),
    renamePath: vi.fn(),
  } as unknown as UseFileTabsReturn & {
    pinTab: ReturnType<typeof vi.fn>;
    closeTab: ReturnType<typeof vi.fn>;
    renamePath: ReturnType<typeof vi.fn>;
  };
}

describe('useExplorerNewFileOps failures', () => {
  it('reports a failed create with the existing copy and closes the optimistic tab', () => {
    const onError = vi.fn();
    const fileTabs = makeFileTabs();
    const { result } = renderHook(() => useExplorerNewFileOps(fileTabs, onError));

    result.current.onFileCreateFailed('a.ts', 'boom');

    expect(onError).toHaveBeenCalledWith('Failed to create a.ts: boom');
    expect(fileTabs.closeTab).toHaveBeenCalledWith('a.ts');
  });

  it('reports a failed delete with the existing copy', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useExplorerNewFileOps(makeFileTabs(), onError));

    result.current.onFileDeleteFailed('src/a.ts', 'Permission denied');

    expect(onError).toHaveBeenCalledWith('Failed to delete src/a.ts: Permission denied');
  });

  it('reports a failed rename with the existing copy', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useExplorerNewFileOps(makeFileTabs(), onError));

    result.current.onFileRenameFailed('old.ts', 'Name taken');

    expect(onError).toHaveBeenCalledWith('Failed to rename old.ts: Name taken');
  });

  it('reports nothing on success paths', () => {
    const onError = vi.fn();
    const fileTabs = makeFileTabs();
    const { result } = renderHook(() => useExplorerNewFileOps(fileTabs, onError));

    result.current.onFileCreated('a.ts');
    result.current.onFileCreateConfirmed('a.ts');
    result.current.onFileDeleteSubmitted('b.ts');
    result.current.onFileDeleteConfirmed('b.ts');
    result.current.onFileRenamed('c.ts', 'd.ts');

    expect(onError).not.toHaveBeenCalled();
  });
});
