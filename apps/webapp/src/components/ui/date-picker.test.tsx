import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DatePicker, DatePickerField } from './date-picker';

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
