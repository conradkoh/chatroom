import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModelFilterProviderHeader } from './ModelFilterProviderHeader';

describe('ModelFilterProviderHeader', () => {
  it('renders provider label', () => {
    render(
      <ModelFilterProviderHeader
        providerLabel="Anthropic"
        isProviderHidden={false}
        onToggle={vi.fn()}
      />
    );
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
  });

  it('shows "Hide All" when provider is visible', () => {
    render(
      <ModelFilterProviderHeader
        providerLabel="Anthropic"
        isProviderHidden={false}
        onToggle={vi.fn()}
      />
    );
    expect(screen.getByText('Hide All')).toBeInTheDocument();
  });

  it('shows "Show All" when provider is hidden', () => {
    render(
      <ModelFilterProviderHeader
        providerLabel="Anthropic"
        isProviderHidden={true}
        onToggle={vi.fn()}
      />
    );
    expect(screen.getByText('Show All')).toBeInTheDocument();
  });

  it('calls onToggle on button click', () => {
    const onToggle = vi.fn();
    render(
      <ModelFilterProviderHeader
        providerLabel="Anthropic"
        isProviderHidden={false}
        onToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByText('Hide All'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('disables button when disabled prop is true', () => {
    render(
      <ModelFilterProviderHeader
        providerLabel="Anthropic"
        isProviderHidden={false}
        disabled={true}
        onToggle={vi.fn()}
      />
    );
    expect(screen.getByText('Hide All')).toBeDisabled();
  });
});
