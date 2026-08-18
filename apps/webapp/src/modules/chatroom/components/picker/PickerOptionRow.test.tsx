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

  it('uses pointer cursor when enabled', () => {
    render(<PickerOptionRow onSelect={vi.fn()}>Option A</PickerOptionRow>);
    expect(screen.getByRole('option')).toHaveClass('cursor-pointer');
  });

  it('uses not-allowed cursor when disabled', () => {
    render(
      <PickerOptionRow disabled onSelect={vi.fn()}>
        Option A
      </PickerOptionRow>
    );
    const option = screen.getByRole('option');
    expect(option).toBeDisabled();
    expect(option.className).toContain('disabled:cursor-not-allowed');
  });

  it('merges optional className onto the option button', () => {
    render(
      <PickerOptionRow onSelect={vi.fn()} className="min-h-11 text-sm">
        Option A
      </PickerOptionRow>
    );
    expect(screen.getByRole('option').className).toContain('min-h-11');
    expect(screen.getByRole('option').className).toContain('text-sm');
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

  it('button has min-w-0 for truncation in flex layouts', () => {
    render(<PickerOptionRow onSelect={vi.fn()}>Option A</PickerOptionRow>);
    expect(screen.getByRole('option')).toHaveClass('min-w-0');
  });

  it('label span has min-w-0, flex-1, and truncate classes', () => {
    render(<PickerOptionRow onSelect={vi.fn()}>Option A</PickerOptionRow>);
    const label = screen.getByText('Option A');
    expect(label).toHaveClass('min-w-0');
    expect(label).toHaveClass('flex-1');
    expect(label).toHaveClass('truncate');
  });

  it('renders endAdornment outside the label span', () => {
    render(
      <PickerOptionRow
        onSelect={vi.fn()}
        endAdornment={<span data-testid="picker-row-end-adornment">Badge</span>}
      >
        Option A
      </PickerOptionRow>
    );
    const adornment = screen.getByTestId('picker-row-end-adornment');
    const label = screen.getByText('Option A');
    const button = screen.getByRole('option');

    expect(label).not.toContainElement(adornment);
    expect(label.parentElement).toBe(button);
    expect(adornment.parentElement).toBe(button);
  });

  it('renders trailingActions outside the option button', () => {
    render(
      <PickerOptionRow
        onSelect={vi.fn()}
        trailingActions={
          <button type="button" data-testid="trailing-action">
            Act
          </button>
        }
      >
        Option A
      </PickerOptionRow>
    );
    const option = screen.getByRole('option');
    const action = screen.getByTestId('trailing-action');
    expect(option.parentElement).toContainElement(action);
    expect(option).not.toContainElement(action);
  });

  it('hides Check icon when trailingActions and selected', () => {
    render(
      <PickerOptionRow
        selected
        onSelect={vi.fn()}
        trailingActions={<span data-testid="trailing-wrap">actions</span>}
      >
        Option A
      </PickerOptionRow>
    );
    const option = screen.getByRole('option');
    expect(option.querySelector('svg')).toBeNull();
  });

  it('when multiline, label wrapper wraps text instead of truncating', () => {
    render(
      <PickerOptionRow multiline onSelect={vi.fn()}>
        Option A
      </PickerOptionRow>
    );
    const label = screen.getByText('Option A');
    expect(label).toHaveClass('break-words');
    expect(label).toHaveClass('whitespace-normal');
    expect(label).not.toHaveClass('truncate');
  });

  it('when multiline, button has items-start', () => {
    render(
      <PickerOptionRow multiline onSelect={vi.fn()}>
        Option A
      </PickerOptionRow>
    );
    expect(screen.getByRole('option')).toHaveClass('items-start');
  });

  it('does not call onSelect when trailing action is clicked', () => {
    const onSelect = vi.fn();
    render(
      <PickerOptionRow
        onSelect={onSelect}
        trailingActions={
          <button type="button" data-testid="trailing-action" onClick={() => {}}>
            Act
          </button>
        }
      >
        Option A
      </PickerOptionRow>
    );
    fireEvent.click(screen.getByTestId('trailing-action'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
