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
});
