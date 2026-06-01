import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFileEntries } from './useFileEntries';

describe('useFileEntries', () => {
  const treeJson = JSON.stringify({
    entries: [
      { path: 'src/index.ts', type: 'file' },
      { path: 'src/auth', type: 'directory' },
    ],
  });

  it('returns files only by default', () => {
    const { result } = renderHook(() => useFileEntries({ treeJson }));
    expect(result.current).toEqual([{ path: 'src/index.ts', type: 'file' }]);
  });

  it('includes directories when includeDirectories is true', () => {
    const { result } = renderHook(() =>
      useFileEntries({ treeJson }, { includeDirectories: true })
    );
    expect(result.current).toEqual([
      { path: 'src/index.ts', type: 'file' },
      { path: 'src/auth', type: 'directory' },
    ]);
  });
});
