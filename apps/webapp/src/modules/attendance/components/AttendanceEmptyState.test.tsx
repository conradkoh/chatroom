import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceEmptyState } from './AttendanceEmptyState';

describe('AttendanceEmptyState', () => {
  it('renders message and join button', async () => {
    const onJoin = vi.fn();
    const user = userEvent.setup();
    render(<AttendanceEmptyState message="No attendees yet" onJoin={onJoin} />);
    expect(screen.getByText('No attendees yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /join the list/i }));
    expect(onJoin).toHaveBeenCalled();
  });

  it('hides join button when showJoinButton is false', () => {
    render(<AttendanceEmptyState message="Empty" onJoin={() => {}} showJoinButton={false} />);
    expect(screen.queryByRole('button', { name: /join the list/i })).not.toBeInTheDocument();
  });
});
