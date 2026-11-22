import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationJumpToTopButton } from './ConversationJumpToTopButton';
import { JUMP_TO_NEW_MESSAGES_Z_INDEX } from '../../components/timeline/timelineVirtualizerConfig';

function renderButton(overrides: Partial<Parameters<typeof ConversationJumpToTopButton>[0]> = {}) {
  const props = {
    onClick: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    ...overrides,
  };
  render(<ConversationJumpToTopButton {...props} />);
  const button = screen.getByRole('button', { name: 'Jump to top' });
  return { ...props, button };
}

describe('ConversationJumpToTopButton', () => {
  it('renders an icon-only button named "Jump to top"', () => {
    const { button } = renderButton();
    expect(button).toHaveAttribute('type', 'button');
  });

  it('calls onClick when clicked', () => {
    const { button, onClick } = renderButton();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onPause on mouseEnter and focus, and onResume on mouseLeave and blur', () => {
    const { button, onPause, onResume } = renderButton();

    fireEvent.mouseEnter(button);
    expect(onPause).toHaveBeenCalledTimes(1);

    fireEvent.focus(button);
    expect(onPause).toHaveBeenCalledTimes(2);

    fireEvent.mouseLeave(button);
    expect(onResume).toHaveBeenCalledTimes(1);

    fireEvent.blur(button);
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it('is not auto-focused', () => {
    renderButton();
    expect(document.activeElement).toBe(document.body);
  });

  it('uses only chatroom tokens (no hard-coded colours)', () => {
    const { button } = renderButton();
    const className = button.className;

    expect(className).toContain('bg-chatroom-accent');
    expect(className).toContain('text-chatroom-text-on-accent');
    expect(className).toContain('right-3');
    expect(className).toContain('md:right-4');
    expect(className).toContain('h-10');
    expect(className).toContain('w-10');
    expect(className).toContain('md:h-9');
    expect(className).toContain('md:w-9');
    expect(className).toContain('motion-reduce:animate-none');

    /** Any Tailwind palette colour utility that is not a chatroom token, or a raw colour literal. */
    const HARD_CODED_COLOUR =
      /\b(?:bg|text|border|ring(?:-offset)?|fill|stroke|from|via|to|shadow|outline|decoration)-(?!chatroom-)(?:[a-z]+-\d{2,3}(?:\/\d+)?|white|black|transparent)\b|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\b(?:oklch|hsl)\(/;

    expect(className).not.toMatch(HARD_CODED_COLOUR);
    // the pattern itself must catch palette and raw colours (guards against a regex that matches nothing):
    expect('bg-orange-500').toMatch(HARD_CODED_COLOUR);
    expect('text-amber-400').toMatch(HARD_CODED_COLOUR);
    expect('bg-[#ff8800]').toMatch(HARD_CODED_COLOUR);
    expect('bg-chatroom-accent/90').not.toMatch(HARD_CODED_COLOUR);
    expect('ring-offset-orange-500').toMatch(HARD_CODED_COLOUR);
    expect('focus-visible:ring-offset-amber-300').toMatch(HARD_CODED_COLOUR);
    expect('focus-visible:ring-offset-2').not.toMatch(HARD_CODED_COLOUR);
  });

  it('uses the shared chip gap and z-index', () => {
    const { button } = renderButton();
    expect(button.style.bottom).toBe('8px');
    expect(button.style.zIndex).toBe(String(JUMP_TO_NEW_MESSAGES_Z_INDEX));
    expect(button.style.zIndex).toBe('20');
  });
});
