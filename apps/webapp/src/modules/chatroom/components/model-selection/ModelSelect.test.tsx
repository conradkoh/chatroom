import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { ModelSelect } from './ModelSelect';
import type { ModelGroup } from './types';

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

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const GROUPS: ModelGroup[] = [
  {
    providerKey: 'openai',
    providerLabel: 'OpenAI',
    options: [
      { value: 'openai::gpt-4o', label: 'GPT-4o' },
      { value: 'openai::gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
  },
  {
    providerKey: 'opencode',
    providerLabel: 'OpenCode',
    options: [{ value: 'opencode::big-pickle', label: 'Big Pickle' }],
  },
];

function openDropdown() {
  const trigger = screen.getByTitle('Select model');
  fireEvent.click(trigger);
}

describe('ModelSelect', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(true);
  });

  it('shows an empty-state label when groups are empty', () => {
    render(<ModelSelect groups={[]} value="" onValueChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'No models available yet' })).toHaveTextContent(
      'No models yet'
    );
    expect(screen.getByRole('button', { name: 'No models available yet' })).toBeDisabled();
  });

  it('shows an empty-state label when all models are hidden', () => {
    const isHidden = () => true;
    render(<ModelSelect groups={GROUPS} value="" onValueChange={vi.fn()} isHidden={isHidden} />);

    expect(screen.getByRole('button', { name: 'No models available yet' })).toHaveTextContent(
      'No models yet'
    );
    expect(screen.getByRole('button', { name: 'No models available yet' })).toBeDisabled();
  });

  it('uses conventional harness trigger styling by default', () => {
    render(<ModelSelect groups={GROUPS} value="" onValueChange={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Select model' });
    expect(trigger.className).toContain('bg-chatroom-bg-tertiary');
    expect(trigger.className).toContain('uppercase');
    expect(trigger.className).not.toContain('border-input');
  });

  it('renders popover content with opaque chatroom primary background', () => {
    mockUseIsDesktop.mockReturnValue(true);
    render(<ModelSelect groups={GROUPS} value="" onValueChange={vi.fn()} />);
    openDropdown();

    const content = document.querySelector('[data-slot="chatroom-popover-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain('bg-chatroom-bg-primary');
    expect(content?.className).not.toContain('bg-chatroom-bg-surface');
  });

  it('renders drawer content on mobile viewport', () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(<ModelSelect groups={GROUPS} value="" onValueChange={vi.fn()} />);
    openDropdown();

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
  });

  it('renders all models when no isHidden prop is passed', () => {
    render(<ModelSelect groups={GROUPS} value="" onValueChange={vi.fn()} />);
    openDropdown();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.getByText('GPT-4 Turbo')).toBeInTheDocument();
    expect(screen.getByText('Big Pickle')).toBeInTheDocument();
  });

  it('hides models for which isHidden returns true', () => {
    const isHidden = (key: string) => key === 'openai::gpt-4-turbo';
    render(<ModelSelect groups={GROUPS} value="" onValueChange={vi.fn()} isHidden={isHidden} />);
    openDropdown();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.queryByText('GPT-4 Turbo')).not.toBeInTheDocument();
    expect(screen.getByText('Big Pickle')).toBeInTheDocument();
  });

  it('omits provider group entirely when ALL its models are hidden', () => {
    const isHidden = (key: string) => key.startsWith('opencode::');
    render(<ModelSelect groups={GROUPS} value="" onValueChange={vi.fn()} isHidden={isHidden} />);
    openDropdown();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.queryByText('Big Pickle')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument();
  });

  it('shows the trigger label for the selected model even when isHidden returns true for it', () => {
    const isHidden = (key: string) => key === 'openai::gpt-4o';
    render(
      <ModelSelect
        groups={GROUPS}
        value="openai::gpt-4o"
        onValueChange={vi.fn()}
        isHidden={isHidden}
      />
    );
    expect(screen.getByTitle('Select model')).toBeInTheDocument();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    openDropdown();
    const listItems = screen.queryAllByRole('option');
    const gpt4oItem = listItems.find((el) => el.textContent?.includes('GPT-4o'));
    expect(gpt4oItem).toBeUndefined();
  });

  it('renders a focusable search input on mobile viewport', () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(<ModelSelect groups={GROUPS} value="" onValueChange={vi.fn()} />);
    openDropdown();
    const searchInput = screen.getByPlaceholderText('Search models…');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('type', 'search');
  });
});
