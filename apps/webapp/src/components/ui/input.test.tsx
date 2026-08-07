import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from './input';

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
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
  });
});
