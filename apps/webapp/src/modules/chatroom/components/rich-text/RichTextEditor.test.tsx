import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { backlogRichTextEditorProseClassNames } from '../markdown-utils';
import { RichTextEditor } from './RichTextEditor';

describe('RichTextEditor', () => {
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
});
