import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AllTabAnchorNavigator } from './AllTabAnchorNavigator';

describe('AllTabAnchorNavigator', () => {
  it('renders jump to latest disabled when on latest anchor', () => {
    render(
      <AllTabAnchorNavigator
        hasPrev={false}
        hasNext={false}
        isOnLatestAnchor
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onJumpToLatest={vi.fn()}
      />
    );

    const jumpButton = screen.getByRole('button', { name: 'Jump to latest' });
    expect((jumpButton as HTMLButtonElement).disabled).toBe(true);
    expect(jumpButton.className).toContain('text-chatroom-text-muted');
  });

  it('renders jump to latest enabled with accent styling when not on latest', () => {
    render(
      <AllTabAnchorNavigator
        hasPrev
        hasNext
        isOnLatestAnchor={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onJumpToLatest={vi.fn()}
      />
    );

    const jumpButton = screen.getByRole('button', { name: 'Jump to latest' });
    expect((jumpButton as HTMLButtonElement).disabled).toBe(false);
    expect(jumpButton.className).toContain('bg-chatroom-accent');
  });

  it('calls onJumpToLatest when jump button is clicked', () => {
    const onJumpToLatest = vi.fn();
    render(
      <AllTabAnchorNavigator
        hasPrev
        hasNext={false}
        isOnLatestAnchor={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onJumpToLatest={onJumpToLatest}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(onJumpToLatest).toHaveBeenCalledTimes(1);
  });

  it('disables all buttons when isLoading is true', () => {
    render(
      <AllTabAnchorNavigator
        hasPrev={true}
        hasNext={true}
        isOnLatestAnchor={false}
        isLoading={true}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onJumpToLatest={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Previous user message')).toBeDisabled();
    expect(screen.getByLabelText('Jump to latest')).toBeDisabled();
    expect(screen.getByLabelText('Next user message')).toBeDisabled();
  });

  it('uses compact mobile height classes on nav buttons', () => {
    render(
      <AllTabAnchorNavigator
        hasPrev
        hasNext
        isOnLatestAnchor={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onJumpToLatest={vi.fn()}
      />
    );

    const prevButton = screen.getByLabelText('Previous user message');
    expect(prevButton.className).toMatch(/\bh-7\b/);
    expect(prevButton.className).toMatch(/\bmd:h-9\b/);
  });
});
