import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { HarnessModelSelect } from './HarnessModelSelect';

// jsdom does not provide matchMedia (used by vaul drawer and useIsDesktop)
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

// Radix UI Popover uses ResizeObserver — polyfill for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const PROVIDERS = [
  {
    providerID: 'openai',
    name: 'OpenAI',
    models: [
      { modelID: 'gpt-4o', name: 'GPT-4o' },
      { modelID: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    ],
  },
  {
    providerID: 'opencode',
    name: 'OpenCode',
    models: [{ modelID: 'big-pickle', name: 'Big Pickle' }],
  },
];

function openDropdown() {
  const trigger = screen.getByTitle('Select model');
  fireEvent.click(trigger);
}

describe('HarnessModelSelect', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(true);
  });
  it('shows an empty-state label when no providers are available', () => {
    render(<HarnessModelSelect providers={[]} value="" onValueChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'No models available yet' })).toHaveTextContent(
      'No models yet'
    );
    expect(screen.getByRole('button', { name: 'No models available yet' })).toBeDisabled();
  });

  it('shows an empty-state label when all models are hidden', () => {
    const isHidden = () => true;
    render(
      <HarnessModelSelect
        providers={PROVIDERS}
        value=""
        onValueChange={vi.fn()}
        isHidden={isHidden}
      />
    );

    expect(screen.getByRole('button', { name: 'No models available yet' })).toHaveTextContent(
      'No models yet'
    );
    expect(screen.getByRole('button', { name: 'No models available yet' })).toBeDisabled();
  });

  it('uses conventional chatroom picker trigger styling', () => {
    render(<HarnessModelSelect providers={PROVIDERS} value="" onValueChange={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Select model' });
    expect(trigger.className).toContain('bg-chatroom-bg-tertiary');
    expect(trigger.className).toContain('uppercase');
    expect(trigger.className).not.toContain('border-input');
  });

  it('renders popover content with opaque chatroom primary background', () => {
    mockUseIsDesktop.mockReturnValue(true);
    render(<HarnessModelSelect providers={PROVIDERS} value="" onValueChange={vi.fn()} />);
    openDropdown();

    const content = document.querySelector('[data-slot="chatroom-popover-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain('bg-chatroom-bg-primary');
    expect(content?.className).not.toContain('bg-chatroom-bg-surface');
  });

  it('renders drawer content on mobile viewport', () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(<HarnessModelSelect providers={PROVIDERS} value="" onValueChange={vi.fn()} />);
    openDropdown();

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
  });

  it('renders all models when no isHidden prop is passed', () => {
    render(<HarnessModelSelect providers={PROVIDERS} value="" onValueChange={vi.fn()} />);
    openDropdown();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.getByText('GPT-4 Turbo')).toBeInTheDocument();
    expect(screen.getByText('Big Pickle')).toBeInTheDocument();
  });

  it('hides models for which isHidden returns true', () => {
    const isHidden = (key: string) => key === 'openai::gpt-4-turbo';
    render(
      <HarnessModelSelect
        providers={PROVIDERS}
        value=""
        onValueChange={vi.fn()}
        isHidden={isHidden}
      />
    );
    openDropdown();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.queryByText('GPT-4 Turbo')).not.toBeInTheDocument();
    expect(screen.getByText('Big Pickle')).toBeInTheDocument();
  });

  it('omits provider group entirely when ALL its models are hidden', () => {
    const isHidden = (key: string) => key.startsWith('opencode::');
    render(
      <HarnessModelSelect
        providers={PROVIDERS}
        value=""
        onValueChange={vi.fn()}
        isHidden={isHidden}
      />
    );
    openDropdown();
    // OpenAI models visible
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    // OpenCode group heading not rendered (no visible models)
    expect(screen.queryByText('Big Pickle')).not.toBeInTheDocument();
    // The heading text for OpenCode should not appear since the group is skipped
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument();
  });

  it('shows the trigger label for the selected model even when isHidden returns true for it', () => {
    // The currently-selected model shows in the trigger regardless of filter
    const isHidden = (key: string) => key === 'openai::gpt-4o';
    render(
      <HarnessModelSelect
        providers={PROVIDERS}
        value="openai::gpt-4o"
        onValueChange={vi.fn()}
        isHidden={isHidden}
      />
    );
    // Label in the closed trigger is derived from providers lookup, still shows
    expect(screen.getByTitle('Select model')).toBeInTheDocument();
    // The trigger shows the selected model's label even though it's "hidden"
    expect(screen.getByText('OpenAI / GPT-4o')).toBeInTheDocument();
    // Open dropdown: the hidden model should NOT appear in the list
    openDropdown();
    // GPT-4o won't appear in the dropdown (it's hidden from the list)
    const listItems = screen.queryAllByRole('option');
    const gpt4oItem = listItems.find((el) => el.textContent?.includes('GPT-4o'));
    // Hidden from the dropdown (but trigger label unchanged)
    expect(gpt4oItem).toBeUndefined();
  });

  it('renders a focusable search input on mobile viewport', () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(<HarnessModelSelect providers={PROVIDERS} value="" onValueChange={vi.fn()} />);
    openDropdown();
    const searchInput = screen.getByPlaceholderText('Search models…');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('type', 'search');
  });
});
