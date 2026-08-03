/**
 * TimelineMessageHeaderNav — centered prev/current/next message navigation.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineMessageHeaderNav } from './TimelineMessageHeaderNav';

function makeNav(overrides: Partial<Parameters<typeof TimelineMessageHeaderNav>[0]> = {}) {
  return {
    onJumpToPrevious: vi.fn(),
    onJumpToCurrent: vi.fn(),
    onJumpToNext: vi.fn(),
    hasPrevious: true,
    hasNext: true,
    ...overrides,
  };
}

describe('TimelineMessageHeaderNav', () => {
  it('renders previous, current, and next buttons', () => {
    render(<TimelineMessageHeaderNav {...makeNav()} />);
    expect(screen.getByTestId('timeline-header-nav-previous')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-header-nav-current')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-header-nav-next')).toBeInTheDocument();
  });

  it('invokes each handler on its button click', () => {
    const nav = makeNav();
    render(<TimelineMessageHeaderNav {...nav} />);

    fireEvent.click(screen.getByTestId('timeline-header-nav-previous'));
    fireEvent.click(screen.getByTestId('timeline-header-nav-current'));
    fireEvent.click(screen.getByTestId('timeline-header-nav-next'));

    expect(nav.onJumpToPrevious).toHaveBeenCalledTimes(1);
    expect(nav.onJumpToCurrent).toHaveBeenCalledTimes(1);
    expect(nav.onJumpToNext).toHaveBeenCalledTimes(1);
  });

  it('disables previous when hasPrevious is false', () => {
    render(<TimelineMessageHeaderNav {...makeNav({ hasPrevious: false })} />);
    expect(screen.getByTestId('timeline-header-nav-previous')).toBeDisabled();
    expect(screen.getByTestId('timeline-header-nav-current')).not.toBeDisabled();
  });

  it('disables next when hasNext is false', () => {
    render(<TimelineMessageHeaderNav {...makeNav({ hasNext: false })} />);
    expect(screen.getByTestId('timeline-header-nav-next')).toBeDisabled();
    expect(screen.getByTestId('timeline-header-nav-current')).not.toBeDisabled();
  });

  it('does not invoke a handler when its button is disabled', () => {
    const nav = makeNav({ hasPrevious: false });
    render(<TimelineMessageHeaderNav {...nav} />);

    fireEvent.click(screen.getByTestId('timeline-header-nav-previous'));

    expect(nav.onJumpToPrevious).not.toHaveBeenCalled();
  });
});
