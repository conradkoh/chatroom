import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginCodeGenerator } from './LoginCodeGenerator';

/**
 * Boundary mocks only: Convex session hooks, the auth state, and the browser clipboard.
 * The component under test and its feedback primitives run for real.
 */
const mocks = vi.hoisted(() => ({
  createLoginCode: vi.fn(),
  activeCode: { success: false, reason: 'no_active_code' } as unknown,
  writeText: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.createLoginCode,
  useSessionQuery: () => mocks.activeCode,
}));

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuthState: () => ({ state: 'authenticated', user: { _id: 'user-1', type: 'full' } }),
}));

const CODE_LIFETIME_MS = 60_000;

/**
 * The component syncs the active code during render by comparing query identity, so the
 * code only lands after the query object changes. Render once with "no code", then rerender
 * with the active code.
 */
function renderWithActiveCode(code = 'ABCD1234') {
  const view = render(<LoginCodeGenerator />);
  mocks.activeCode = { success: true, code, expiresAt: Date.now() + CODE_LIFETIME_MS };
  view.rerender(<LoginCodeGenerator />);
  return view;
}

describe('LoginCodeGenerator', () => {
  beforeEach(() => {
    mocks.activeCode = { success: false, reason: 'no_active_code' };
    mocks.createLoginCode.mockReset();
    mocks.writeText.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the used-code status as role=status and clears it on the next generate attempt', async () => {
    const view = renderWithActiveCode();
    mocks.activeCode = { success: false, reason: 'no_active_code' };
    view.rerender(<LoginCodeGenerator />);

    const slot = screen.getByTestId('login-code-feedback');
    expect(slot).toHaveAttribute('role', 'status');
    expect(slot).toHaveTextContent('Your login code was used successfully');

    mocks.createLoginCode.mockResolvedValueOnce({
      success: true,
      code: 'WXYZ5678',
      expiresAt: Date.now() + CODE_LIFETIME_MS,
    });
    fireEvent.click(screen.getByLabelText('Generate a login code'));
    await act(async () => {});

    expect(screen.queryByTestId('login-code-feedback')).toBeNull();
  });

  it('dismisses the used-code status with its Dismiss button', () => {
    const view = renderWithActiveCode();
    mocks.activeCode = { success: false, reason: 'no_active_code' };
    view.rerender(<LoginCodeGenerator />);

    const slot = screen.getByTestId('login-code-feedback');
    fireEvent.click(within(slot).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('login-code-feedback')).toBeNull();
  });

  it('shows a rejected generation as one role=alert and no status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createLoginCode.mockRejectedValueOnce(new Error('boom'));

    render(<LoginCodeGenerator />);
    fireEvent.click(screen.getByLabelText('Generate a login code'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('An error occurred while generating login code');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows an unsuccessful generation as role=alert text', async () => {
    mocks.createLoginCode.mockResolvedValueOnce({ success: false });

    render(<LoginCodeGenerator />);
    fireEvent.click(screen.getByLabelText('Generate a login code'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to generate login code');
  });

  it('shows no feedback text when generation succeeds', async () => {
    mocks.createLoginCode.mockResolvedValueOnce({
      success: true,
      code: 'ABCD1234',
      expiresAt: Date.now() + CODE_LIFETIME_MS,
    });

    render(<LoginCodeGenerator />);
    fireEvent.click(screen.getByLabelText('Generate a login code'));

    await screen.findByLabelText('Copy login code to clipboard');
    expect(screen.queryByTestId('login-code-feedback')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('flips the copy icon to Check for 2 s on success and shows no text', async () => {
    vi.useFakeTimers();
    mocks.writeText.mockResolvedValueOnce(undefined);

    renderWithActiveCode();

    const copyButton = screen.getByLabelText('Copy login code to clipboard');
    expect(copyButton.querySelector('svg')).toHaveClass('lucide-copy');

    fireEvent.click(copyButton);
    await act(async () => {});

    expect(copyButton.querySelector('svg')).toHaveClass('lucide-check');
    expect(screen.queryByTestId('login-code-feedback')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyButton.querySelector('svg')).toHaveClass('lucide-copy');
    expect(screen.queryByTestId('login-code-feedback')).toBeNull();
  });

  it('shows a clipboard rejection as role=alert text and keeps the copy icon', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.writeText.mockRejectedValueOnce(new Error('denied'));

    renderWithActiveCode();

    const copyButton = screen.getByLabelText('Copy login code to clipboard');
    fireEvent.click(copyButton);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to copy code to clipboard');
    expect(copyButton.querySelector('svg')).toHaveClass('lucide-copy');
  });

  it('Dismiss clears a copy failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.writeText.mockRejectedValueOnce(new Error('denied'));

    renderWithActiveCode();
    fireEvent.click(screen.getByLabelText('Copy login code to clipboard'));

    const slot = await screen.findByTestId('login-code-feedback');
    fireEvent.click(within(slot).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('login-code-feedback')).toBeNull();
  });
});
