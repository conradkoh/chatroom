import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownEditor } from './MarkdownEditor';

vi.mock('./MarkdownToolbar', () => ({ MarkdownToolbar: () => null }));
vi.mock('../hooks/useMarkdownEditor', () => ({
  useMarkdownEditor: () => ({ editor: { chain: () => ({ focus: () => ({ run: vi.fn() }) }) } }),
}));
vi.mock('@tiptap/react', () => ({
  useEditor: () => ({ chain: () => ({ focus: () => ({ run: vi.fn() }) }) }),
  EditorContent: ({ className }: { className?: string }) => (
    <div data-testid="markdown-editor-content" className={className} />
  ),
}));

describe('MarkdownEditor', () => {
  it('applies caller prose classes', () => {
    render(<MarkdownEditor proseClassName="prose prose-p:my-2" />);
    expect(screen.getByTestId('markdown-editor-content')).toHaveClass('prose-p:my-2');
  });
});
