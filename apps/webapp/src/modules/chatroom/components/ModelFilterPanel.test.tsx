import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelFilterPanel } from './ModelFilterPanel';

const mockUseIsDesktop = vi.fn();
const mockKeyboardInset = vi.fn();

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => mockUseIsDesktop() }));
vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => mockKeyboardInset(),
  useVisualViewportOffsetTop: () => 0,
}));

describe('ModelFilterPanel mobile keyboard layout', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockKeyboardInset.mockReturnValue(300);
  });

  it('keeps model rows visible and filters them while the keyboard is open', async () => {
    const user = userEvent.setup();
    render(
      <ModelFilterPanel
        open
        onOpenChange={vi.fn()}
        trigger={<button type="button">Filter</button>}
        availableModels={['openai/gpt-4o', 'anthropic/claude-sonnet-4']}
        filter={null}
        onFilterChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        screen.queryAllByText('Model Visibility').some((node) => node.tagName === 'SPAN')
      ).toBe(false);
    });
    expect(screen.queryByText('Reset All')).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);

    await user.type(screen.getByPlaceholderText(/search models/i), 'gpt');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('shows panel chrome when the keyboard is closed', () => {
    mockKeyboardInset.mockReturnValue(0);
    render(
      <ModelFilterPanel
        open
        onOpenChange={vi.fn()}
        trigger={<button type="button">Filter</button>}
        availableModels={['openai/gpt-4o']}
        filter={null}
        onFilterChange={vi.fn()}
      />
    );
    expect(screen.getAllByText('Model Visibility').some((node) => node.tagName === 'SPAN')).toBe(
      true
    );
    expect(screen.getByText('Reset All')).toBeInTheDocument();
  });
});
