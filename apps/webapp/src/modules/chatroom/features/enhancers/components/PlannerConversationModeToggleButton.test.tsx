import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlannerConversationModeToggleButton } from './PlannerConversationModeToggleButton';

describe('PlannerConversationModeToggleButton', () => {
  it('uses fixed responsive sizing', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={false}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );
    const button = screen.getByTestId('planner-conversation-mode-toggle');

    expect(button.className).toContain('w-[3.75rem]');
    expect(button.className).toContain('px-0');
    expect(button.className).toContain('sm:w-full');
    expect(button.className).toContain('sm:px-3');
  });

  it('shows Chat label and aria-label in chat mode', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="chat"
        isBusy={false}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByTestId('planner-conversation-mode-toggle')).toHaveAttribute(
      'aria-label',
      'Mode: Chat'
    );
  });

  it('shows Code label and aria-label in code mode', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={false}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    expect(screen.getByText('Code')).toBeInTheDocument();
    expect(screen.getByTestId('planner-conversation-mode-toggle')).toHaveAttribute(
      'aria-label',
      'Mode: Code'
    );
  });

  it('shows Enhanced label and aria-label in code:enhanced mode', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="code:enhanced"
        isBusy={false}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    expect(screen.getByText('Enhanced')).toBeInTheDocument();
    expect(screen.getByTestId('planner-conversation-mode-toggle')).toHaveAttribute(
      'aria-label',
      'Mode: Enhanced'
    );
  });

  it('does not render aria-pressed', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={false}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('planner-conversation-mode-toggle')).not.toHaveAttribute(
      'aria-pressed'
    );
  });

  it('sets aria-busy when busy', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={true}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('planner-conversation-mode-toggle')).toHaveAttribute(
      'aria-busy',
      'true'
    );
  });

  it('remains activatable (not natively disabled) when busy for optimistic rapid activation', () => {
    const onCycle = vi.fn();
    render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={true}
        teamSupportState="supported"
        onCycle={onCycle}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    const button = screen.getByTestId('planner-conversation-mode-toggle');
    // Not natively disabled — allows rapid clicking
    expect(button).not.toBeDisabled();
    // Still has aria-busy for accessibility
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('calls onCycle when clicked while busy', () => {
    const onCycle = vi.fn();
    render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={true}
        teamSupportState="supported"
        onCycle={onCycle}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    screen.getByTestId('planner-conversation-mode-toggle').click();
    expect(onCycle).toHaveBeenCalledTimes(1);
  });

  it('does not call onCycle when loading', () => {
    const onCycle = vi.fn();
    render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={false}
        teamSupportState="loading"
        onCycle={onCycle}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    screen.getByTestId('planner-conversation-mode-toggle').click();
    expect(onCycle).not.toHaveBeenCalled();
  });

  it('does not disable Chat/Code when unsupported', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={false}
        teamSupportState="unsupported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('planner-conversation-mode-toggle')).not.toBeDisabled();
  });

  it('shows Configure context menu only for supported teams', () => {
    const { rerender } = render(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={false}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    // Context menu is in the DOM but hidden until triggered
    expect(screen.queryByTestId('planner-conversation-mode-configure')).not.toBeInTheDocument();

    rerender(
      <PlannerConversationModeToggleButton
        mode="code"
        isBusy={false}
        teamSupportState="unsupported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    // Context menu should not exist for unsupported teams
    expect(screen.queryByTestId('planner-conversation-mode-configure')).not.toBeInTheDocument();
  });

  it('shows enhanced mode styling for code:enhanced', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="code:enhanced"
        isBusy={false}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    const button = screen.getByTestId('planner-conversation-mode-toggle');
    expect(button.className).toContain('text-blue-500');
    expect(button.className).toContain('dark:text-blue-400');
  });

  it('shows chat mode styling for chat', () => {
    render(
      <PlannerConversationModeToggleButton
        mode="chat"
        isBusy={false}
        teamSupportState="supported"
        onCycle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    const button = screen.getByTestId('planner-conversation-mode-toggle');
    expect(button.className).toContain('text-emerald-500');
    expect(button.className).toContain('dark:text-emerald-400');
  });
});
