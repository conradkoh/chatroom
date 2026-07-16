import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SearchConfigQuickPick } from './SearchConfigQuickPick';

const mockHarnesses: any[] = [
  {
    name: 'opencode-sdk',
    label: 'SDK',
    providers: [
      { providerID: 'openai', name: 'OpenAI', models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }] },
    ],
  },
];

describe('SearchConfigQuickPick', () => {
  it('renders favorites with apply callback', () => {
    const onApply = vi.fn();
    render(
      <SearchConfigQuickPick
        favorites={[{ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' }]}
        harnesses={mockHarnesses}
        currentEntry={null}
        onApply={onApply}
        onAddFavorite={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
        isFavorite={() => false}
      />
    );
    expect(screen.getByTestId('search-config-quick-pick')).toBeInTheDocument();
    expect(screen.getByText(/SDK/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/SDK/));
    expect(onApply).toHaveBeenCalled();
  });

  it('shows Add to Favorites when current entry not favorited', () => {
    render(
      <SearchConfigQuickPick
        favorites={[]}
        harnesses={mockHarnesses}
        currentEntry={{ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' }}
        onApply={vi.fn()}
        onAddFavorite={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
        isFavorite={() => false}
      />
    );
    expect(screen.getByText('Add to Favorites')).toBeInTheDocument();
  });

  it('shows favorited message when current entry is favorited', () => {
    render(
      <SearchConfigQuickPick
        favorites={[{ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' }]}
        harnesses={mockHarnesses}
        currentEntry={{ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' }}
        onApply={vi.fn()}
        onAddFavorite={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
        isFavorite={() => true}
      />
    );
    expect(screen.getByText('Current config is favorited')).toBeInTheDocument();
  });
});
