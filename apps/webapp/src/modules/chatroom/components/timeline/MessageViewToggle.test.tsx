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

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'User' })).toHaveAttribute('aria-selected', 'false');

    await user.click(screen.getByRole('tab', { name: 'User' }));
    expect(onChange).toHaveBeenCalledWith('user-only');
  });

  it('fits within header row without expanding the container', () => {
    render(<MessageViewToggle mode="all" onChange={vi.fn()} />);

    const toggle = screen.getByTestId('message-view-toggle');
    expect(toggle.className).toMatch(/\bh-6\b/);
    expect(toggle.className).toContain('shrink-0');
    expect(toggle.className).not.toMatch(/\bh-7\b/);

    const allTab = screen.getByRole('tab', { name: 'All' });
    expect(allTab.className).toMatch(/\bh-5\b/);
    expect(allTab.className).toContain('items-center');
    expect(allTab.className).toContain('justify-center');
    expect(allTab.className).toContain('leading-none');
    expect(allTab.className).not.toContain('h-full');
  });
});
