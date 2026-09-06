import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';

vi.mock('../../workspace/file-renderers/SyntaxHighlighter', () => ({
  SyntaxHighlighter: ({ code }: { code: string }) => (
    <pre data-testid="syntax-highlighted">
      <code>{code}</code>
    </pre>
  ),
}));

const OUTER_WRAPPED = '```markdown\n## Summary\nBody text\n```';
const UNWRAPPED = '## Summary\n\nBody text\n\n```typescript\nconst value = 1;\n```';

describe('TimelineMarkdownBody real render', () => {
  it('renders normalized handoff markdown as headings and inner fenced code blocks', () => {
    render(<TimelineMarkdownBody content={UNWRAPPED} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    const block = screen.getByTestId('syntax-highlighted');
    expect(block.textContent).toContain('const value = 1;');
  });

  it('renders the outer-fence-wrapped body as a single code block (no heading)', () => {
    render(<TimelineMarkdownBody content={OUTER_WRAPPED} />);

    expect(screen.queryByRole('heading', { level: 2, name: 'Summary' })).not.toBeInTheDocument();
    const block = screen.getByTestId('syntax-highlighted');
    expect(block.textContent).toContain('## Summary');
    expect(block.textContent).toContain('Body text');
  });
});
