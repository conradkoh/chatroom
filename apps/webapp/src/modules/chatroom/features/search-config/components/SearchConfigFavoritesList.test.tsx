import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SearchConfigFavoritesList } from './SearchConfigFavoritesList';

const mockHarnesses: any[] = [
  {
    name: 'opencode-sdk',
    providers: [
      { providerID: 'openai', name: 'OpenAI', models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }] },
    ],
  },
];

describe('SearchConfigFavoritesList', () => {
  it('renders favorites with apply callback on click', () => {
    const onApply = vi.fn();
    render(
      <SearchConfigFavoritesList
        favorites={[{ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' }]}
        harnesses={mockHarnesses}
        onApply={onApply}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
      />
    );
    expect(screen.getByTestId('search-config-favorites-list')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/OpenAI/));
    expect(onApply).toHaveBeenCalled();
  });

  it('returns null when favorites empty', () => {
    const { container } = render(
      <SearchConfigFavoritesList
        favorites={[]}
        harnesses={mockHarnesses}
        onApply={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders move up, move down, and remove buttons', () => {
    render(
      <SearchConfigFavoritesList
        favorites={[{ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' }]}
        harnesses={mockHarnesses}
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
