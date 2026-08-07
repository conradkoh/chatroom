import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScheduledPromptsActivityBarItem } from './ScheduledPromptsActivityBarItem';

vi.mock('./ScheduledPromptsDialog', () => ({
  ScheduledPromptsDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="scheduled-prompts-dialog">Dialog</div> : null,
}));

describe('ScheduledPromptsActivityBarItem', () => {
  it('renders the clock button', () => {
    render(<ScheduledPromptsActivityBarItem chatroomId="room-1" />);
    expect(screen.getByTestId('scheduled-prompts-activity-bar-item')).toBeInTheDocument();
  });

  it('has accessible label and title', () => {
    render(<ScheduledPromptsActivityBarItem chatroomId="room-1" />);
    const button = screen.getByTestId('scheduled-prompts-activity-bar-item');
    expect(button).toHaveAttribute('title', 'Scheduled prompts');
    expect(button).toHaveAttribute('aria-label', 'Scheduled prompts');
  });

  it('opens the dialog on click', () => {
    render(<ScheduledPromptsActivityBarItem chatroomId="room-1" />);
    expect(screen.queryByTestId('scheduled-prompts-dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('scheduled-prompts-activity-bar-item'));
    expect(screen.getByTestId('scheduled-prompts-dialog')).toBeInTheDocument();
  });
});
