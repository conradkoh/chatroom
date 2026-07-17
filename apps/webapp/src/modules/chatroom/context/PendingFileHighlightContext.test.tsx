import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  PendingFileHighlightProvider,
  usePendingFileHighlight,
} from './PendingFileHighlightContext';

describe('PendingFileHighlightContext', () => {
  it('stores and peeks highlight for matching file path', () => {
    const { result } = renderHook(() => usePendingFileHighlight(), {
      wrapper: PendingFileHighlightProvider,
    });

    const location = { filePath: 'apps/webapp/src/foo.ts', startLine: 42, endLine: 48 };

    act(() => {
      result.current.setPendingHighlight(location);
    });

    expect(result.current.peekHighlightForFile('apps/webapp/src/foo.ts')).toEqual(location);
    expect(result.current.peekHighlightForFile('apps/webapp/src/other.ts')).toBeNull();
  });

  it('consumes highlight for matching file path', () => {
    const { result } = renderHook(() => usePendingFileHighlight(), {
      wrapper: PendingFileHighlightProvider,
    });

    const location = { filePath: 'apps/webapp/src/foo.ts', startLine: 10 };

    act(() => {
      result.current.setPendingHighlight(location);
    });

    let consumed: ReturnType<typeof result.current.consumeHighlightForFile>;
    act(() => {
      consumed = result.current.consumeHighlightForFile('apps/webapp/src/foo.ts');
    });

    expect(consumed!).toEqual(location);
    expect(result.current.pendingHighlight).toBeNull();
  });

  it('replaces highlight when a new citation is set', () => {
    const { result } = renderHook(() => usePendingFileHighlight(), {
      wrapper: PendingFileHighlightProvider,
    });

    act(() => {
      result.current.setPendingHighlight({
        filePath: 'apps/webapp/src/foo.ts',
        startLine: 1,
      });
    });

    const updated = { filePath: 'apps/webapp/src/foo.ts', startLine: 99, endLine: 100 };
    act(() => {
      result.current.setPendingHighlight(updated);
    });

    expect(result.current.peekHighlightForFile('apps/webapp/src/foo.ts')).toEqual(updated);
  });
});
