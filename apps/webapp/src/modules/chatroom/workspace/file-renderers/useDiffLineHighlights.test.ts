import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stripDiffPrefix, useDiffLineHighlights } from './useDiffLineHighlights';
import type { DiffLine } from '../utils/diff-parser';

const mockHighlight = vi.fn();

vi.mock('./useHighlighter', () => ({
  useHighlighter: () => ({
    status: 'ready',
    highlight: mockHighlight,
  }),
}));

vi.mock('./language-detection', () => ({
  detectLanguage: (path: string) => (path.endsWith('.ts') ? { lang: 'ts', isEager: true } : null),
}));

beforeEach(() => {
  mockHighlight.mockReset();
  mockHighlight.mockResolvedValue('<pre class="shiki"><code><span>highlighted</span></code></pre>');
});

describe('stripDiffPrefix', () => {
  it('strips + prefix', () => {
    expect(stripDiffPrefix('+const x = 1;')).toBe('const x = 1;');
  });

  it('strips - prefix', () => {
    expect(stripDiffPrefix('-const x = 1;')).toBe('const x = 1;');
  });

  it('strips leading space prefix', () => {
    expect(stripDiffPrefix(' const x = 1;')).toBe('const x = 1;');
  });
});

describe('useDiffLineHighlights', () => {
  const lines: DiffLine[] = [
    { type: 'hunk', content: '@@ -1 +1 @@' },
    { type: 'context', content: ' const x = 1;' },
    { type: 'addition', content: '+const y = 2;' },
    {
      type: 'deletion',
      content: '-const z = 3;',
      intraSegments: [{ text: 'const z = 3;', type: 'changed' }],
    },
  ];

  it('highlights eligible lines and maps by index', async () => {
    const { result } = renderHook(() => useDiffLineHighlights('file.ts', lines));

    await waitFor(() => {
      expect(result.current.size).toBe(3);
    });

    expect(mockHighlight).toHaveBeenCalledWith('const x = 1;', 'file.ts');
    expect(mockHighlight).toHaveBeenCalledWith('const y = 2;', 'file.ts');
    expect(mockHighlight).toHaveBeenCalledWith('const z = 3;', 'file.ts');
    expect(result.current.get(1)).toContain('highlighted');
    expect(result.current.get(2)).toContain('highlighted');
    expect(result.current.get(3)).toContain('highlighted');
  });

  it('skips hunk headers, intra-line diffs, and unknown file types', async () => {
    const { result } = renderHook(() => useDiffLineHighlights('file.bin', lines));

    await waitFor(() => {
      expect(mockHighlight).not.toHaveBeenCalled();
    });

    expect(result.current.size).toBe(0);
  });

  it('returns empty map when file path is empty', async () => {
    const { result } = renderHook(() => useDiffLineHighlights('', lines));

    await waitFor(() => {
      expect(mockHighlight).not.toHaveBeenCalled();
    });

    expect(result.current.size).toBe(0);
  });
});
