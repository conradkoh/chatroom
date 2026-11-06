import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlannerConversationModeToggleButton } from './PlannerConversationModeToggleButton';

describe('PlannerConversationModeToggleButton', () => {
  it.each([
    ['chat', 'Chat', 'Mode: Chat', 'Code'],
    ['code', 'Code', 'Mode: Code', 'Chat'],
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
    render(<PlannerConversationModeToggleButton mode="code" onCycle={onCycle} />);
    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    expect(onCycle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('planner-conversation-mode-configure')).not.toBeInTheDocument();
  });
});
