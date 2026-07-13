import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { HarnessAgentSelect } from './HarnessAgentSelect';
import { CAPABILITIES_REFRESH_HINT } from './select-empty-states';

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

function openDropdown() {
  const trigger = screen.getByTitle('Select agent');
  fireEvent.click(trigger);
}

describe('HarnessAgentSelect', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(true);
  });

  it('shows "default" when no agents are available yet', () => {
    render(
      <HarnessAgentSelect agents={[]} value="" onValueChange={vi.fn()} resolvedAgent="builder" />
    );

    expect(screen.getByRole('button', { name: 'No agents available yet' })).toHaveTextContent(
      'default'
    );
    expect(screen.getByRole('button', { name: 'No agents available yet' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No agents available yet' })).toHaveAttribute(
      'title',
      CAPABILITIES_REFRESH_HINT
    );
  });

  it('shows "default" for single-role harnesses', () => {
    render(
      <HarnessAgentSelect
        agents={[{ name: 'builder', mode: 'primary' }]}
        value="builder"
        onValueChange={vi.fn()}
        resolvedAgent="builder"
      />
    );

    expect(screen.getByRole('button', { name: 'Select agent' })).toHaveTextContent('default');
    expect(screen.getByRole('button', { name: 'Select agent' })).not.toBeDisabled();
  });

  it('renders agent names when multiple roles are available', () => {
    render(
      <HarnessAgentSelect
        agents={[
          { name: 'builder', mode: 'primary' },
          { name: 'reviewer', mode: 'subagent' },
          { name: 'planner', mode: 'all' },
        ]}
        value="builder"
        onValueChange={vi.fn()}
        resolvedAgent="builder"
      />
    );

    expect(screen.getByRole('button', { name: 'Select agent' })).toHaveTextContent('builder');
    expect(screen.getByRole('button', { name: 'Select agent' })).not.toBeDisabled();
  });

  it('opens picker and shows agent options', () => {
    render(
      <HarnessAgentSelect
        agents={[
          { name: 'builder', mode: 'primary' },
          { name: 'planner', mode: 'all' },
        ]}
        value="builder"
        onValueChange={vi.fn()}
        resolvedAgent="builder"
      />
    );
    openDropdown();

    // "builder" shows as "default" for multi-role too because displayAgentRoleName
    // uses the agent name only when there are multiple eligible agents (primary|all)
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
  });

  it('filters agents by search term when multiple roles', () => {
    render(
      <HarnessAgentSelect
        agents={[
          { name: 'builder', mode: 'primary' },
          { name: 'planner', mode: 'all' },
        ]}
        value="builder"
        onValueChange={vi.fn()}
        resolvedAgent="builder"
      />
    );
    openDropdown();

    const searchInput = screen.getByPlaceholderText('Search agents…');
    fireEvent.change(searchInput, { target: { value: 'planner' } });

    expect(screen.getByText('planner')).toBeInTheDocument();
    // "builder" shows as "default" — not matched by "planner" search
    expect(screen.queryByText('default')).not.toBeInTheDocument();
  });

  it('shows empty search state when no agents match', () => {
    render(
      <HarnessAgentSelect
        agents={[
          { name: 'builder', mode: 'primary' },
          { name: 'planner', mode: 'all' },
        ]}
        value="builder"
        onValueChange={vi.fn()}
        resolvedAgent="builder"
      />
    );
    openDropdown();

    const searchInput = screen.getByPlaceholderText('Search agents…');
    fireEvent.change(searchInput, { target: { value: 'zzzzz' } });

    expect(screen.getByText('No agents found.')).toBeInTheDocument();
  });

  it('renders drawer content on mobile viewport', () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(
      <HarnessAgentSelect
        agents={[{ name: 'builder', mode: 'primary' }]}
        value="builder"
        onValueChange={vi.fn()}
        resolvedAgent="builder"
      />
    );
    openDropdown();

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
  });
});
