import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./MarkdownToolbar', () => ({ MarkdownToolbar: () => null }));
vi.mock('./useMarkdownEditor', () => ({ useMarkdownEditor: () => ({ editor: {} }) }));
vi.mock('@tiptap/react', () => ({ EditorContent: ({ className }: { className?: string }) => <div data-testid="markdown-editor-content" className={className} /> }));
import { MarkdownEditor } from './MarkdownEditor';
describe('MarkdownEditor', () => { it('applies caller prose classes', () => { render(<MarkdownEditor proseClassName="prose prose-p:my-2" />); expect(screen.getByTestId('markdown-editor-content')).toHaveClass('prose-p:my-2'); }); });
