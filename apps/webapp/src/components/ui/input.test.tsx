import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from './input';

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toHaveClass(
      'rounded-none',
      'bg-chatroom-bg-secondary',
      'border-chatroom-border',
      'text-chatroom-text-primary'
    );
  });

  it('accepts user input', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<Input aria-label="Name" />);
    const input = screen.getByLabelText('Name');
    await user.type(input, 'Alice');
    expect(input).toHaveValue('Alice');
  });

  it('respects disabled state', () => {
    render(<Input disabled aria-label="Disabled" />);
    expect(screen.getByLabelText('Disabled')).toBeDisabled();
    expect(screen.getByLabelText('Disabled')).toHaveClass('disabled:opacity-50');
  });

  it('uses the industrial invalid field token', () => {
    render(<Input aria-label="Invalid" aria-invalid="true" />);
    expect(screen.getByLabelText('Invalid')).toHaveClass(
      'aria-invalid:border-chatroom-status-error'
    );
  });
});
