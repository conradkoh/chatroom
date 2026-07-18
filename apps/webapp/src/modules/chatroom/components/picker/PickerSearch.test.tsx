import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PickerSearch } from './PickerSearch';

const mockUseIsDesktop = vi.fn();

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

function mockDesktop(desktop: boolean) {
  mockUseIsDesktop.mockReturnValue(desktop);
}

function renderSearch(overrides: Record<string, unknown> = {}) {
  return render(<PickerSearch value="" onChange={vi.fn()} {...overrides} />);
}

describe('PickerSearch autoFocus', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReset();
  });

  // undefined (platform default):
  it('autoFocus on desktop when prop omitted', () => {
    mockDesktop(true);
    renderSearch();
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('no autoFocus on mobile when prop omitted', () => {
    mockDesktop(false);
    renderSearch();
    expect(screen.getByRole('searchbox')).not.toHaveFocus();
  });

  // explicit true (caller override):
  it('autoFocus on desktop when autoFocus={true}', () => {
    mockDesktop(true);
    renderSearch({ autoFocus: true });
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('autoFocus on mobile when autoFocus={true}', () => {
    mockDesktop(false);
    renderSearch({ autoFocus: true });
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  // explicit false:
  it('no autoFocus on desktop when autoFocus={false}', () => {
    mockDesktop(true);
    renderSearch({ autoFocus: false });
    expect(screen.getByRole('searchbox')).not.toHaveFocus();
  });

  it('no autoFocus on mobile when autoFocus={false}', () => {
    mockDesktop(false);
    renderSearch({ autoFocus: false });
    expect(screen.getByRole('searchbox')).not.toHaveFocus();
  });
});

describe('PickerSearch iOS click-to-focus', () => {
  it('focuses input on container click', () => {
    mockDesktop(false);
    renderSearch();
    const input = screen.getByRole('searchbox');
    expect(input).not.toHaveFocus();
    input.parentElement!.click();
    expect(input).toHaveFocus();
  });
});

describe('PickerSearch vaul drawer support', () => {
  it('wraps input in data-vaul-no-drag container', () => {
    renderSearch();
    const wrapper = screen.getByRole('searchbox').parentElement;
    expect(wrapper).toHaveAttribute('data-vaul-no-drag');
  });

  it('input has data-vaul-no-drag attribute', () => {
    renderSearch();
    expect(screen.getByRole('searchbox')).toHaveAttribute('data-vaul-no-drag');
  });
});
