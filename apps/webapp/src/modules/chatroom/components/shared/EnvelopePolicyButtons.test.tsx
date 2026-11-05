import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationModeButton, SessionPolicyButton } from './EnvelopePolicyButtons';

describe('SessionPolicyButton', () => {
  it('reflects the new-session state and its title', () => {
    render(<SessionPolicyButton isNewSession pending={false} onToggle={vi.fn()} testId="s" />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('title', 'New session enabled — click to disable.');
    expect(button).toHaveClass('text-yellow-500');
  });

  it('reflects the continue-session state and its title', () => {
    render(
      <SessionPolicyButton isNewSession={false} pending={false} onToggle={vi.fn()} testId="s" />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', 'New session disabled — click to enable.');
    expect(button).not.toHaveClass('text-yellow-500');
  });

  it('calls onToggle once per click', () => {
    const onToggle = vi.fn();
    render(<SessionPolicyButton isNewSession pending={false} onToggle={onToggle} testId="s" />);

    fireEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('is disabled and busy while pending', () => {
    render(<SessionPolicyButton isNewSession pending onToggle={vi.fn()} testId="s" />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ConversationModeButton', () => {
  it('labels the chat mode', () => {
    render(<ConversationModeButton mode="chat" pending={false} onCycle={vi.fn()} testId="m" />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Mode: Chat');
    expect(button).toHaveAttribute('title', 'Mode: Chat — click to switch to Code.');
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('labels the code mode', () => {
    render(<ConversationModeButton mode="code" pending={false} onCycle={vi.fn()} testId="m" />);

    const button = screen.getByRole('button', { name: 'Mode: Code' });
    expect(button).toHaveAttribute('title', 'Mode: Code — click to switch to Chat.');
  });

  it('calls onCycle once per click', () => {
    const onCycle = vi.fn();
    render(<ConversationModeButton mode="chat" pending={false} onCycle={onCycle} testId="m" />);

    fireEvent.click(screen.getByRole('button'));

    expect(onCycle).toHaveBeenCalledTimes(1);
  });

  it('is disabled and busy while pending', () => {
    render(<ConversationModeButton mode="code" pending onCycle={vi.fn()} testId="m" />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
