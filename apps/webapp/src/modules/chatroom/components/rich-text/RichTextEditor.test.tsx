import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RichTextEditor } from './RichTextEditor';

describe('RichTextEditor', () => {
  it('renders the editor toolbar', () => {
    render(<RichTextEditor value="# Hello" onChange={() => {}} placeholder="Write something..." />);

    expect(screen.getByTitle('Bold')).toBeInTheDocument();
    expect(screen.getByTitle('Italic')).toBeInTheDocument();
    expect(screen.getByTitle('Heading 1')).toBeInTheDocument();
  });
});
