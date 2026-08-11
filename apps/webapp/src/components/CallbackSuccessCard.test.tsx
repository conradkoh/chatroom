import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CallbackSuccessCard } from './CallbackSuccessCard';

describe('CallbackSuccessCard', () => {
  it('renders login success message with redirect countdown', () => {
    render(
      <CallbackSuccessCard
        flowType="login"
        userName="Alice"
        autoCloseDelay={10}
        redirectTo="/app"
      />
    );
    expect(screen.getByText(/Welcome back, Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Redirecting in 10s/)).toBeInTheDocument();
  });

  it('calls onClose when countdown completes', async () => {
    const onClose = vi.fn();
    render(<CallbackSuccessCard onClose={onClose} autoCloseDelay={0} />);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('redirects to returnTo when countdown completes', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { assign },
      writable: true,
    });

    render(<CallbackSuccessCard redirectTo="/app" autoCloseDelay={0} />);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/app'), { timeout: 2000 });
  });

  it('redirects to /login when redirectTo is not provided', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { assign },
      writable: true,
    });

    render(<CallbackSuccessCard autoCloseDelay={0} />);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/login'), { timeout: 2000 });
  });
});
