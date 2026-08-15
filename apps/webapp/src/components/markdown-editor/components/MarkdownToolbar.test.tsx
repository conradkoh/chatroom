import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownToolbar } from './MarkdownToolbar';

describe('MarkdownToolbar', () => {
  it('copies the editor markdown source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const editor = {
      getMarkdown: () => '<p>Hi</p>',
      getAttributes: () => ({}),
      isActive: () => false,
      chain: () => ({
        focus: () => ({
          toggleBold: () => ({ run: vi.fn() }),
          toggleItalic: () => ({ run: vi.fn() }),
          toggleHeading: () => ({ run: vi.fn() }),
          toggleBulletList: () => ({ run: vi.fn() }),
          toggleOrderedList: () => ({ run: vi.fn() }),
          toggleCode: () => ({ run: vi.fn() }),
          extendMarkRange: () => ({
            setLink: () => ({ run: vi.fn() }),
            unsetLink: () => ({ run: vi.fn() }),
          }),
        }),
      }),
    } as never;

    render(<MarkdownToolbar editor={editor} />);
    fireEvent.click(screen.getByTitle('Copy markdown'));

    expect(writeText).toHaveBeenCalledWith('Hi');
  });
});
