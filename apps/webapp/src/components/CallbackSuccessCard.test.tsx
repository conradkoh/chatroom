import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CallbackSuccessCard } from './CallbackSuccessCard';

describe('CallbackSuccessCard', () => {
  it('renders login success message', () => {
    render(<CallbackSuccessCard flowType="login" userName="Alice" autoCloseDelay={10} />);
    expect(screen.getByText(/Welcome back, Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Closing in 10s/)).toBeInTheDocument();
  });

  it('calls onClose when countdown completes', async () => {
    const onClose = vi.fn();
    render(<CallbackSuccessCard onClose={onClose} autoCloseDelay={0} />);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
  });
});
