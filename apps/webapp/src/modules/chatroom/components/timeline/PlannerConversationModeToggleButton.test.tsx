import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlannerConversationModeToggleButton } from './PlannerConversationModeToggleButton';

describe('PlannerConversationModeToggleButton', () => {
  it.each([
    ['chat', 'Chat', 'Mode: Chat', 'Code'],
    ['code', 'Code', 'Mode: Code', 'Enhance'],
    ['code:enhanced', 'Enhance', 'Mode: Enhance', 'Chat'],
  ] as const)('renders %s mode presentation', (mode, label, ariaLabel, nextLabel) => {
    render(<PlannerConversationModeToggleButton mode={mode} onCycle={vi.fn()} />);
    const button = screen.getByTestId('planner-conversation-mode-toggle');
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', ariaLabel);
    expect(button).toHaveAttribute('title', expect.stringContaining(nextLabel));
    expect(button).toHaveAttribute('title', expect.stringContaining('Ctrl+M'));
  });

  it('cycles through the mode when clicked', () => {
    const onCycle = vi.fn();
    render(<PlannerConversationModeToggleButton mode="code:enhanced" onCycle={onCycle} />);
    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    expect(onCycle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('planner-conversation-mode-configure')).not.toBeInTheDocument();
  });

  it('highlights Enhance mode with the request-first semantic tint', () => {
    render(<PlannerConversationModeToggleButton mode="code:enhanced" onCycle={vi.fn()} />);
    expect(screen.getByTestId('planner-conversation-mode-toggle').className).toContain(
      'text-blue-500'
    );
  });
});
