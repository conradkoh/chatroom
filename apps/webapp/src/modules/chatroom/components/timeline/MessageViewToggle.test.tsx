/**
 * MessageViewToggle — segmented control for All / My messages view.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { MessageViewToggle } from './MessageViewToggle';

describe('MessageViewToggle', () => {
  it('renders both tabs and calls onChange on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<MessageViewToggle mode="all" onChange={onChange} />);

    expect(screen.getByRole('tab', { name: 'All messages' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'My messages' })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    await user.click(screen.getByRole('tab', { name: 'My messages' }));
    expect(onChange).toHaveBeenCalledWith('user-only');
  });
});
