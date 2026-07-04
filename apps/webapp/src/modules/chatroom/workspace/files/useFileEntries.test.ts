import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFileEntries } from './useFileEntries';

describe('useFileEntries', () => {
  const entries = [
    { path: 'src/index.ts', type: 'file' as const },
    { path: 'src/auth', type: 'directory' as const },
  ];

  it('returns files only by default', () => {
    const { result } = renderHook(() => useFileEntries({ entries }));
    expect(result.current).toEqual([{ path: 'src/index.ts', type: 'file' }]);
  });

  it('includes directories when includeDirectories is true', () => {
    const { result } = renderHook(() => useFileEntries({ entries }, { includeDirectories: true }));
    expect(result.current).toEqual(entries);
  });
});
