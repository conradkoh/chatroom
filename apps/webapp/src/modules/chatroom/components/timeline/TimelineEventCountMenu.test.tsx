import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineEventCountMenu } from './TimelineEventCountMenu';
import { MESSAGE_STORE_LIMIT } from '../../hooks/chatroomMessageStore';

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

describe('TimelineEventCountMenu', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders event count', () => {
    render(<TimelineEventCountMenu eventCount={12} canPurge={true} onPurge={vi.fn()} />);
    expect(screen.getByText('12 EVENTS')).toBeInTheDocument();
  });

  it('purge menu item is disabled when at limit', () => {
    render(
      <TimelineEventCountMenu eventCount={MESSAGE_STORE_LIMIT} canPurge={false} onPurge={vi.fn()} />
    );
    const trigger = screen.getByRole('button', { name: 'Timeline event options' });
    expect(trigger).toBeDisabled();
  });

  it('calls onPurge when menu item is clicked (mobile drawer)', () => {
    mockUseIsDesktop.mockReturnValue(false);
    const onPurge = vi.fn();
    render(<TimelineEventCountMenu eventCount={12} canPurge={true} onPurge={onPurge} />);

    const trigger = screen.getByRole('button', { name: 'Timeline event options' });
    fireEvent.click(trigger);

    const menuItem = screen.getByText('Purge loaded history');
    fireEvent.click(menuItem);

    expect(onPurge).toHaveBeenCalledOnce();
  });
});
