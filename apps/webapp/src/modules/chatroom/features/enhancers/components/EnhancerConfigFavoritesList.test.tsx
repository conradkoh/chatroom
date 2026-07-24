import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnhancerConfigFavoritesList } from './EnhancerConfigFavoritesList';

const favorite = {
  targetId: 'handoff:planner-to-builder' as const,
  agentHarness: 'opencode' as const,
  model: 'anthropic/claude-opus-4',
};

describe('EnhancerConfigFavoritesList', () => {
  it('renders favorites with apply callback on click', () => {
    const onApply = vi.fn();
    render(
      <EnhancerConfigFavoritesList
        favorites={[favorite]}
        onApply={onApply}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
      />
    );
    expect(screen.getByTestId('enhancer-config-favorites-list')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/OpenCode/));
    expect(onApply).toHaveBeenCalledWith(favorite);
  });

  it('returns null when favorites empty', () => {
    const { container } = render(
      <EnhancerConfigFavoritesList
        favorites={[]}
        onApply={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders truncation classes with long label', () => {
    const longLabelFav = {
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'opencode' as const,
      model: 'OPENCODE / BIG PICKLE',
    };
    const { container } = render(
      <EnhancerConfigFavoritesList
        favorites={[longLabelFav]}
        onApply={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
      />
    );
    const row = container.querySelector('.min-w-0');
    expect(row).toBeInTheDocument();
    const labelSpan = container.querySelector('.truncate');
    expect(labelSpan).toBeInTheDocument();
    expect(labelSpan?.textContent).toContain('★');
    expect(labelSpan?.textContent).toContain('OpenCode');
  });

  it('renders move up, move down, and remove buttons', () => {
    render(
      <EnhancerConfigFavoritesList
        favorites={[favorite]}
        onApply={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Move up')).toBeInTheDocument();
    expect(screen.getByLabelText('Move down')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove favorite')).toBeInTheDocument();
  });
});
