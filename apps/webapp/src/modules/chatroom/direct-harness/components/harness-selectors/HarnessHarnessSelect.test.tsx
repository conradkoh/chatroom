import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { HarnessHarnessSelect } from './HarnessHarnessSelect';
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

const HARNESSES = [
  { name: 'pi-sdk', displayName: 'Pi (SDK)', agents: [], providers: [] },
  { name: 'cursor-sdk', displayName: 'Cursor (SDK)', agents: [], providers: [] },
];

function openDropdown() {
  const trigger = screen.getByTitle('Select harness');
  fireEvent.click(trigger);
}

describe('HarnessHarnessSelect', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(true);
  });

  it('shows an empty-state label when no harnesses are available', () => {
    render(<HarnessHarnessSelect harnesses={[]} value="pi-sdk" onValueChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'No harnesses available' })).toHaveTextContent(
      'No harnesses available'
    );
    expect(screen.getByRole('button', { name: 'No harnesses available' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No harnesses available' })).toHaveAttribute(
      'title',
      CAPABILITIES_REFRESH_HINT
    );
  });

  it('renders harness options when available', () => {
    render(<HarnessHarnessSelect harnesses={HARNESSES} value="pi-sdk" onValueChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Select harness' })).toHaveTextContent('Pi (SDK)');
    expect(screen.getByRole('button', { name: 'Select harness' })).not.toBeDisabled();
  });

  it('opens picker and shows harness option rows', () => {
    render(<HarnessHarnessSelect harnesses={HARNESSES} value="pi-sdk" onValueChange={vi.fn()} />);
    openDropdown();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Pi (SDK)');
    expect(options[1]).toHaveTextContent('Cursor (SDK)');
  });

  it('filters harnesses by search term', () => {
    render(<HarnessHarnessSelect harnesses={HARNESSES} value="pi-sdk" onValueChange={vi.fn()} />);
    openDropdown();

    const searchInput = screen.getByPlaceholderText('Search harnesses…');
    fireEvent.change(searchInput, { target: { value: 'Cursor' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Cursor (SDK)');
  });

  it('shows empty search state when no harnesses match', () => {
    render(<HarnessHarnessSelect harnesses={HARNESSES} value="pi-sdk" onValueChange={vi.fn()} />);
    openDropdown();

    const searchInput = screen.getByPlaceholderText('Search harnesses…');
    fireEvent.change(searchInput, { target: { value: 'zzzzz' } });

    expect(screen.getByText('No harnesses found.')).toBeInTheDocument();
  });

  it('renders drawer content on mobile viewport', () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(<HarnessHarnessSelect harnesses={HARNESSES} value="pi-sdk" onValueChange={vi.fn()} />);
    openDropdown();

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
  });
});
