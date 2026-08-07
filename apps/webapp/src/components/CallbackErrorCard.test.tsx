import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CallbackErrorCard } from './CallbackErrorCard';

describe('CallbackErrorCard', () => {
  it('renders user-friendly error for expired token', () => {
    render(<CallbackErrorCard error="token expired" flowType="login" />);
    expect(screen.getByText('Sign In Failed')).toBeInTheDocument();
    expect(screen.getByText(/authentication request has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close window/i })).toBeInTheDocument();
  });
});
