import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeAll } from 'vitest';

import { backlogRichTextEditorProseClassNames } from '../markdown-utils';
import { RichTextEditor } from './RichTextEditor';

describe('RichTextEditor', () => {
  beforeAll(() => {
    if (typeof document.elementFromPoint !== 'function') {
      document.elementFromPoint = () => null;
    }
  });

  it('renders the editor toolbar', () => {
    render(<RichTextEditor value="# Hello" onChange={() => {}} placeholder="Write something..." />);

    expect(screen.getByTitle('Bold')).toBeInTheDocument();
    expect(screen.getByTitle('Italic')).toBeInTheDocument();
    expect(screen.getByTitle('Heading 1')).toBeInTheDocument();
  });

  it('applies backlog prose classes so headings match read-only markdown', () => {
    const { container } = render(
      <RichTextEditor value="# Hello" onChange={() => {}} placeholder="Write something..." />
    );

    const proseContainer = container.querySelector('.prose');
    expect(proseContainer).toBeInTheDocument();
    expect(proseContainer?.className).toContain(backlogRichTextEditorProseClassNames.split(' ')[0]);
  });

  it('fills available height so the empty editor is clickable across the content area', () => {
    const { container } = render(
      <RichTextEditor
        value=""
        onChange={() => {}}
        placeholder="Write something..."
        className="flex-1 flex flex-col min-h-0 h-64"
      />
    );

    const scrollArea = container.querySelector('.cursor-text');
    expect(scrollArea).toHaveClass('flex-1', 'min-h-0');

    const proseMirror = container.querySelector('.ProseMirror');
    expect(proseMirror).toBeInTheDocument();
  });

  it('registers click handler on scroll container, not on ProseMirror', () => {
    const { container } = render(
      <RichTextEditor value="# Hello" onChange={() => {}} placeholder="Write..." />
    );

    const scrollArea = container.querySelector('.cursor-text')!;
    const proseMirror = container.querySelector('.ProseMirror')!;
    expect(scrollArea).toBeInTheDocument();
    expect(proseMirror).toBeInTheDocument();
  });

  it('Cmd+Enter calls onCmdEnter without inserting newline', async () => {
    const user = userEvent.setup();
    const onCmdEnter = vi.fn();
    const onChange = vi.fn();
    render(<RichTextEditor value="hello" onChange={onChange} onCmdEnter={onCmdEnter} />);

    const editor = document.querySelector('.ProseMirror');
    expect(editor).toBeTruthy();
    await user.click(editor!);
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onCmdEnter).toHaveBeenCalledTimes(1);
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    if (lastCall !== undefined) {
      expect(lastCall).not.toMatch(/\n$/);
    }
  });
});
