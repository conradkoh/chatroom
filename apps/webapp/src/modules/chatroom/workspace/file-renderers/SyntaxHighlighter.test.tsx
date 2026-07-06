import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SyntaxHighlighter } from './SyntaxHighlighter';

const mockHighlight = vi.fn();
const mockUseTheme = vi.fn();

vi.mock('next-themes', () => ({
  useTheme: () => mockUseTheme(),
}));

vi.mock('./useHighlighter', () => ({
  useHighlighter: () => ({
    status: 'ready',
    highlight: mockHighlight,
  }),
}));

vi.mock('./language-detection', () => ({
  detectLanguage: () => ({ lang: 'ts', isEager: true }),
  MAX_FILE_SIZE: 1_000_000,
}));

beforeEach(() => {
  mockHighlight.mockReset();
  mockHighlight.mockResolvedValue('<pre class="shiki"><code>highlighted</code></pre>');
  mockUseTheme.mockReturnValue({ resolvedTheme: 'light' });
});

describe('SyntaxHighlighter', () => {
  it('calls highlight with dark theme when resolvedTheme is dark', async () => {
    mockUseTheme.mockReturnValue({ resolvedTheme: 'dark' });

    render(<SyntaxHighlighter code="const x = 1;" path="file.ts" />);

    await waitFor(() => {
      expect(mockHighlight).toHaveBeenCalledWith('const x = 1;', 'file.ts', 'dark');
    });
  });

  it('calls highlight with light theme when resolvedTheme is light', async () => {
    render(<SyntaxHighlighter code="const x = 1;" path="file.ts" />);

    await waitFor(() => {
      expect(mockHighlight).toHaveBeenCalledWith('const x = 1;', 'file.ts', 'light');
    });
  });
});
