import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SyntaxHighlighter } from './SyntaxHighlighter';

const mockHighlight = vi.fn();

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
  mockHighlight.mockResolvedValue(
    '<pre class="shiki shiki-themes github-light github-dark"><code>highlighted</code></pre>'
  );
});

describe('SyntaxHighlighter', () => {
  it('renders dual-theme shiki output without binding to resolvedTheme', async () => {
    render(<SyntaxHighlighter code="const x = 1;" path="file.ts" />);

    await waitFor(() => {
      expect(mockHighlight).toHaveBeenCalledWith('const x = 1;', 'file.ts');
    });
  });

  it('applies transparent shiki background wrapper class', async () => {
    const { container } = render(<SyntaxHighlighter code="const x = 1;" path="file.ts" />);

    await waitFor(() => {
      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain('[&_.shiki]:bg-transparent');
    });
  });
});
