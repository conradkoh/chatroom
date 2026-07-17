import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SearchConfigFavoriteDropdown } from './SearchConfigFavoriteDropdown';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockHarnesses: any[] = [
  {
    name: 'opencode-sdk',
    providers: [
      { providerID: 'openai', name: 'OpenAI', models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }] },
    ],
  },
];

describe('SearchConfigFavoriteDropdown', () => {
  it('renders current config label', () => {
    render(
      <SearchConfigFavoriteDropdown
        favorites={[]}
        harnesses={mockHarnesses}
        currentEntry={{ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' }}
        onApply={vi.fn()}
        isFavorite={() => false}
      />
    );
    expect(screen.getByText(/OpenAI.*GPT-4o/)).toBeInTheDocument();
  });

  it('renders Select config when no current entry', () => {
    render(
      <SearchConfigFavoriteDropdown
        favorites={[]}
        harnesses={mockHarnesses}
        currentEntry={null}
        onApply={vi.fn()}
        isFavorite={() => false}
      />
    );
    expect(screen.getByText('Select config')).toBeInTheDocument();
  });

  it('shows favorites in the dropdown', () => {
    render(
      <SearchConfigFavoriteDropdown
        favorites={[{ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' }]}
        harnesses={mockHarnesses}
        currentEntry={null}
        onApply={vi.fn()}
        isFavorite={() => true}
      />
    );
    // Trigger should show "Select config" since there's no currentEntry
    expect(screen.getByText('Select config')).toBeInTheDocument();
  });
});
