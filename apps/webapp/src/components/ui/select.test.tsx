import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

describe('Select', () => {
  it('renders selected item label instead of raw value', () => {
    render(
      <Select value="apple" onValueChange={() => {}}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectContent>
      </Select>
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText('apple')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveClass('rounded-none', 'border-chatroom-border');
  });

  it('renders placeholder when no value selected', () => {
    render(
      <Select value={null} onValueChange={() => {}}>
        <SelectTrigger>
          <SelectValue placeholder="Pick a fruit" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
        </SelectContent>
      </Select>
    );
    expect(screen.getByText('Pick a fruit')).toBeInTheDocument();
  });

  it('uses industrial styling for the open content and item', () => {
    render(
      <Select open value="apple" onValueChange={() => {}}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
        </SelectContent>
      </Select>
    );
    expect(screen.getByRole('combobox')).toHaveClass('rounded-none');
    expect(screen.getAllByText('Apple')[1]?.closest('[data-slot="select-item"]')).toHaveClass(
      'rounded-none',
      'focus:bg-chatroom-bg-hover'
    );
    expect(screen.getByRole('listbox').closest('[data-slot="select-content"]')).toHaveClass(
      'bg-chatroom-bg-primary',
      'rounded-none'
    );
  });
});
