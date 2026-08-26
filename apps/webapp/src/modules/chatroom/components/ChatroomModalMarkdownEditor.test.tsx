import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatroomModalMarkdownEditor } from './ChatroomModalMarkdownEditor';

vi.mock('@/components/markdown-editor', () => ({
  MarkdownEditor: (props: { proseClassName: string; normalizeContent?: (s: string) => string }) => (
    <div
      data-testid="editor"
      data-prose={props.proseClassName}
      data-has-normalizer={props.normalizeContent ? 'yes' : 'no'}
    />
  ),
}));
describe('ChatroomModalMarkdownEditor', () => {
  it('forwards prose classes', () => {
    render(
      <ChatroomModalMarkdownEditor value="x" onChange={vi.fn()} proseClassName="prose-p:my-2" />
    );
    expect(screen.getByTestId('editor')).toHaveAttribute('data-prose', 'prose-p:my-2');
  });
  it('forwards the chatroom normalizer', () => {
    render(<ChatroomModalMarkdownEditor value="x" onChange={vi.fn()} proseClassName="prose" />);
    expect(screen.getByTestId('editor')).toHaveAttribute('data-has-normalizer', 'yes');
  });
});
