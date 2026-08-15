import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/components/markdown-editor', () => ({ MarkdownEditor: (props: { proseClassName: string }) => <div data-testid="editor" data-prose={props.proseClassName} /> }));
import { ChatroomModalMarkdownEditor } from './ChatroomModalMarkdownEditor';
describe('ChatroomModalMarkdownEditor', () => { it('forwards prose classes', () => { render(<ChatroomModalMarkdownEditor value="x" onChange={vi.fn()} proseClassName="prose-p:my-2" />); expect(screen.getByTestId('editor')).toHaveAttribute('data-prose', 'prose-p:my-2'); }); });
