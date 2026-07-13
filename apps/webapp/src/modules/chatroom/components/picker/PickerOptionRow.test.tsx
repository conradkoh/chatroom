import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { PickerOptionRow } from './PickerOptionRow';

describe('PickerOptionRow', () => {
  it('renders children label', () => {
    render(<PickerOptionRow onSelect={vi.fn()}>Option A</PickerOptionRow>);
    expect(screen.getByText('Option A')).toBeInTheDocument();
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(<PickerOptionRow onSelect={onSelect}>Option A</PickerOptionRow>);
    fireEvent.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows check icon when selected', () => {
    render(
      <PickerOptionRow selected onSelect={vi.fn()}>
        Option A
      </PickerOptionRow>
    );
    const option = screen.getByRole('option');
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('hides check icon when not selected', () => {
    render(<PickerOptionRow onSelect={vi.fn()}>Option A</PickerOptionRow>);
    const option = screen.getByRole('option');
    expect(option).toHaveAttribute('aria-selected', 'false');
    expect(document.querySelector('svg')).toBeNull();
  });

  it('respects disabled state', () => {
    const onSelect = vi.fn();
    render(
      <PickerOptionRow disabled onSelect={onSelect}>
        Option A
      </PickerOptionRow>
    );
    const option = screen.getByRole('option');
    expect(option).toBeDisabled();
    fireEvent.click(option);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
