/**
 * TimelineMessageHeaderNav — centered first/prev/current/next/last message navigation.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineMessageHeaderNav } from './TimelineMessageHeaderNav';

function makeNav(overrides: Partial<Parameters<typeof TimelineMessageHeaderNav>[0]> = {}) {
  return {
    onJumpToFirst: vi.fn(),
    onJumpToPrevious: vi.fn(),
    onJumpToCurrent: vi.fn(),
    onJumpToNext: vi.fn(),
    onJumpToLast: vi.fn(),
    hasFirst: true,
    hasPrevious: true,
    hasNext: true,
    hasLast: true,
    ...overrides,
  };
}

describe('TimelineMessageHeaderNav', () => {
  it('renders first, previous, current, next, and last buttons', () => {
    render(<TimelineMessageHeaderNav {...makeNav()} />);
    expect(screen.getByTestId('timeline-header-nav-first')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-header-nav-previous')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-header-nav-current')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-header-nav-next')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-header-nav-last')).toBeInTheDocument();
  });

  it('invokes each handler on its button click', () => {
    const nav = makeNav();
    render(<TimelineMessageHeaderNav {...nav} />);

    fireEvent.click(screen.getByTestId('timeline-header-nav-first'));
    fireEvent.click(screen.getByTestId('timeline-header-nav-previous'));
    fireEvent.click(screen.getByTestId('timeline-header-nav-current'));
    fireEvent.click(screen.getByTestId('timeline-header-nav-next'));
    fireEvent.click(screen.getByTestId('timeline-header-nav-last'));

    expect(nav.onJumpToFirst).toHaveBeenCalledTimes(1);
    expect(nav.onJumpToPrevious).toHaveBeenCalledTimes(1);
    expect(nav.onJumpToCurrent).toHaveBeenCalledTimes(1);
    expect(nav.onJumpToNext).toHaveBeenCalledTimes(1);
    expect(nav.onJumpToLast).toHaveBeenCalledTimes(1);
  });

  it('disables first when hasFirst is false', () => {
    render(<TimelineMessageHeaderNav {...makeNav({ hasFirst: false })} />);
    expect(screen.getByTestId('timeline-header-nav-first')).toBeDisabled();
    expect(screen.getByTestId('timeline-header-nav-current')).not.toBeDisabled();
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

  it('disables last when hasLast is false', () => {
    render(<TimelineMessageHeaderNav {...makeNav({ hasLast: false })} />);
    expect(screen.getByTestId('timeline-header-nav-last')).toBeDisabled();
    expect(screen.getByTestId('timeline-header-nav-current')).not.toBeDisabled();
  });

  it('does not invoke a handler when its button is disabled', () => {
    const nav = makeNav({ hasPrevious: false, hasFirst: false, hasLast: false });
    render(<TimelineMessageHeaderNav {...nav} />);

    fireEvent.click(screen.getByTestId('timeline-header-nav-previous'));
    fireEvent.click(screen.getByTestId('timeline-header-nav-first'));
    fireEvent.click(screen.getByTestId('timeline-header-nav-last'));

    expect(nav.onJumpToPrevious).not.toHaveBeenCalled();
    expect(nav.onJumpToFirst).not.toHaveBeenCalled();
    expect(nav.onJumpToLast).not.toHaveBeenCalled();
  });
});
