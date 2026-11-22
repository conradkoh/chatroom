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
    expect(className).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b|\brgb\(|\b(?:bg|text|border|ring)-(?:red|blue|green|slate|gray|zinc|neutral|white|black)\b/
    );
  });

  it('uses the shared chip gap and z-index', () => {
    const { button } = renderButton();
    expect(button.style.bottom).toBe('8px');
    expect(button.style.zIndex).toBe(String(JUMP_TO_NEW_MESSAGES_Z_INDEX));
    expect(button.style.zIndex).toBe('20');
  });
});
