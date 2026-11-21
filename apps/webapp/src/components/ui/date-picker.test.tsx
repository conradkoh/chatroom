import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  composeLocalDateTime,
  DateInput,
  DateTimeField,
  DatePicker,
  DatePickerField,
  formatIsoDate,
  parseIsoDate,
} from './date-picker';

describe('DatePicker', () => {
  it('renders placeholder when no date selected', () => {
    render(<DatePicker placeholder="Pick a date" />);
    expect(screen.getByText('Pick a date')).toBeInTheDocument();
  });

  it('renders formatted date when selected', () => {
    const date = new Date(2026, 7, 16);
    render(<DatePicker date={date} />);
    expect(screen.getByText(date.toLocaleDateString())).toBeInTheDocument();
  });
});

describe('DatePickerField', () => {
  it('renders label and picker', () => {
    render(<DatePickerField id="test-date" label="Start date" />);
    expect(screen.getByText('Start date')).toBeInTheDocument();
    expect(screen.getByText('Pick a date')).toBeInTheDocument();
  });
});

describe('formatIsoDate', () => {
  it('zero-pads a local calendar date', () => {
    expect(formatIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('parseIsoDate', () => {
  it('parses a strict ISO date to local midnight', () => {
    expect(parseIsoDate('2026-11-21')?.getTime()).toBe(new Date(2026, 10, 21).getTime());
  });

  it('rejects impossible and malformed dates', () => {
    expect(parseIsoDate('2026-02-30')).toBeUndefined();
    expect(parseIsoDate('2026-13-01')).toBeUndefined();
    expect(parseIsoDate('26-1-1')).toBeUndefined();
    expect(parseIsoDate('')).toBeUndefined();
  });

  it('accepts a leap day', () => {
    expect(parseIsoDate('2028-02-29')?.getTime()).toBe(new Date(2028, 1, 29).getTime());
  });
});

describe('composeLocalDateTime', () => {
  it('pads hour and minute into the stored contract', () => {
    expect(composeLocalDateTime(new Date(2026, 10, 21), '9', '5')).toBe('2026-11-21T09:05');
  });

  it('returns an empty string for out-of-range time parts', () => {
    expect(composeLocalDateTime(new Date(2026, 10, 21), '24', '5')).toBe('');
    expect(composeLocalDateTime(new Date(2026, 10, 21), '9', '60')).toBe('');
    expect(composeLocalDateTime(new Date(2026, 10, 21), '', '5')).toBe('');
  });

  it('returns an empty string without a date', () => {
    expect(composeLocalDateTime(undefined, '9', '5')).toBe('');
  });
});

describe('DateInput', () => {
  it('shows the ISO text for the value', () => {
    render(<DateInput value={new Date(2026, 10, 21)} onChange={() => {}} aria-label="Date" />);
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-21');
  });

  it('calls onChange with the parsed date when a full date is typed', () => {
    const onChange = vi.fn();
    render(<DateInput onChange={onChange} aria-label="Date" />);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-22' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]?.[0] as Date).getTime()).toBe(new Date(2026, 10, 22).getTime());
  });

  it('calls onChange with undefined when the typed date is partial', () => {
    const onChange = vi.fn();
    render(<DateInput value={new Date(2026, 10, 21)} onChange={onChange} aria-label="Date" />);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-2' } });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('snaps back to the held value on blur and clears the invalid flag', () => {
    render(<DateInput value={new Date(2026, 10, 21)} onChange={() => {}} aria-label="Date" />);
    const input = screen.getByLabelText('Date');

    fireEvent.change(input, { target: { value: '2026-11-2' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('2026-11-21');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('keeps invalid text on blur without a value and reports the invalid flag', () => {
    const onInvalidChange = vi.fn();
    render(<DateInput onChange={() => {}} onInvalidChange={onInvalidChange} aria-label="Date" />);
    const input = screen.getByLabelText('Date');

    fireEvent.change(input, { target: { value: '2026-11-2' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('2026-11-2');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onInvalidChange).toHaveBeenCalledWith(true);
  });

  it('picks a day from the calendar and closes the popover', async () => {
    const onChange = vi.fn();
    render(<DateInput onChange={onChange} min={new Date(2026, 10, 15)} aria-label="Date" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    const day = await screen.findByRole('button', { name: /November 22/ });
    fireEvent.click(day);

    expect((onChange.mock.calls.at(-1)?.[0] as Date).getTime()).toBe(
      new Date(2026, 10, 22).getTime()
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /November 22/ })).not.toBeInTheDocument()
    );
  });

  it('disables days before min', async () => {
    render(<DateInput onChange={() => {}} min={new Date(2026, 10, 15)} aria-label="Date" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));

    expect(await screen.findByRole('button', { name: /November 10/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /November 20/ })).toBeEnabled();
  });

  it('does not re-emit the already-selected day', async () => {
    const onChange = vi.fn();
    render(<DateInput value={new Date(2026, 10, 21)} onChange={onChange} aria-label="Date" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    fireEvent.click(await screen.findByRole('button', { name: /November 21/ }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables the text input and calendar trigger when disabled', () => {
    render(
      <DateInput value={new Date(2026, 10, 21)} onChange={() => {}} disabled aria-label="Date" />
    );

    expect(screen.getByLabelText('Date')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeDisabled();
  });

  it('uses the compact height in compact size', () => {
    render(<DateInput size="compact" onChange={() => {}} aria-label="Date" />);

    expect(screen.getByLabelText('Date').className).toContain('h-6');
  });
});

describe('DateTimeField', () => {
  it('composes date, hour and minute into the stored contract', () => {
    const onChange = vi.fn();
    render(<DateTimeField value="" onChange={onChange} testIdPrefix="run-at" />);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-21' } });
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '30' } });

    expect(onChange.mock.calls.at(-1)?.[0]).toBe('2026-11-21T14:30');
  });

  it('emits an empty string for an out-of-range hour', () => {
    const onChange = vi.fn();
    render(<DateTimeField value="2026-11-21T14:30" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '24' } });

    expect(onChange.mock.calls.at(-1)?.[0]).toBe('');
  });

  it('emits an empty string when the date is cleared', () => {
    const onChange = vi.fn();
    render(<DateTimeField value="2026-11-21T14:30" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } });

    expect(onChange.mock.calls.at(-1)?.[0]).toBe('');
  });

  it('keeps the typed time when a different day is picked', async () => {
    const onChange = vi.fn();
    render(<DateTimeField value="2026-11-21T14:30" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    fireEvent.click(await screen.findByRole('button', { name: /November 22/ }));

    expect(onChange.mock.calls.at(-1)?.[0]).toBe('2026-11-22T14:30');
  });

  it('shows the time hint after blurring an out-of-range hour', () => {
    render(<DateTimeField value="2026-11-21T14:30" onChange={() => {}} />);

    const hour = screen.getByLabelText('Hour');
    fireEvent.change(hour, { target: { value: '24' } });
    fireEvent.blur(hour);

    expect(hour).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Hour 0–23, minute 0–59')).toBeInTheDocument();
  });
});
