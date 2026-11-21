import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProfilePage from './page';

/**
 * Sibling profile sections are stubbed rather than provider-wrapped: ThemeSettings throws
 * outside ThemeProvider, FileStorageSettings needs paginated Convex queries, and the other
 * two sections belong to separate toast-removal slices. This keeps the seam on
 * RecoveryCodeSection, the surface under test. The feedback primitives run for real.
 */
vi.mock('@/modules/profile/NameEditForm', () => ({ NameEditForm: () => null }));
vi.mock('@/modules/auth/LoginCodeGenerator', () => ({ LoginCodeGenerator: () => null }));
vi.mock('@/modules/theme/ThemeSettings', () => ({ ThemeSettings: () => null }));
vi.mock('@/modules/profile/FileStorageSettings', () => ({ FileStorageSettings: () => null }));

const mocks = vi.hoisted(() => ({
  getOrCreate: vi.fn(),
  regenerate: vi.fn(),
  writeText: vi.fn(),
  sessionId: 'session-1' as string | null,
}));

vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useAction: (ref: unknown) =>
      getFunctionName(ref as never) === 'auth:regenerateRecoveryCode'
        ? mocks.regenerate
        : mocks.getOrCreate,
    useQuery: () => undefined,
    useMutation: () => vi.fn(),
  };
});

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => [mocks.sessionId, vi.fn()],
  useSessionQuery: () => undefined,
  useSessionMutation: () => vi.fn(),
}));

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuthState: () => ({ state: 'authenticated', user: { _id: 'user-1', type: 'full' } }),
  useCurrentUser: () => ({ _id: 'user-1', type: 'full' }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

async function revealCode() {
  await userEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Code' }));
}

async function regenerateCode() {
  await userEvent.click(screen.getByRole('button', { name: 'Regenerate Code' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
}

describe('ProfilePage recovery code section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionId = 'session-1';
    mocks.getOrCreate.mockResolvedValue({ success: true, recoveryCode: 'OLD-CODE' });
    mocks.writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a rejected reveal once as alert text in recovery-feedback', async () => {
    mocks.getOrCreate.mockResolvedValueOnce({ success: false, reason: 'Code is unavailable.' });

    render(<ProfilePage />);
    await revealCode();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Code is unavailable.');
    expect(alert).toHaveAttribute('data-testid', 'recovery-feedback');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByText('Code is unavailable.')).toHaveLength(1);
  });

  it('uses the fallback text when a reveal rejection has no reason', async () => {
    mocks.getOrCreate.mockResolvedValueOnce({ success: false });

    render(<ProfilePage />);
    await revealCode();

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to retrieve recovery code.');
  });

  it('shows an unexpected reveal failure as alert text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getOrCreate.mockRejectedValueOnce(new Error('boom'));

    render(<ProfilePage />);
    await revealCode();

    expect(screen.getByRole('alert')).toHaveTextContent('An unexpected error occurred.');
  });

  it('shows a rejected regenerate as alert text and keeps the old code', async () => {
    mocks.regenerate.mockResolvedValueOnce({
      success: false,
      reason: 'Regeneration is blocked.',
    });

    render(<ProfilePage />);
    await revealCode();
    await regenerateCode();

    expect(screen.getByRole('alert')).toHaveTextContent('Regeneration is blocked.');
    expect(screen.getByRole('textbox')).toHaveValue('OLD-CODE');
  });

  it('clears the slot when the next reveal attempt starts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getOrCreate.mockRejectedValueOnce(new Error('boom'));

    render(<ProfilePage />);
    await revealCode();
    expect(screen.getByRole('alert')).toHaveTextContent('An unexpected error occurred.');

    mocks.getOrCreate.mockImplementation(() => new Promise(() => {}));
    await revealCode();

    expect(screen.queryByTestId('recovery-feedback')).toBeNull();
  });

  it('clears the slot on Dismiss', async () => {
    mocks.getOrCreate.mockResolvedValueOnce({ success: false, reason: 'Code is unavailable.' });

    render(<ProfilePage />);
    await revealCode();

    const slot = screen.getByTestId('recovery-feedback');
    await userEvent.click(within(slot).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('recovery-feedback')).toBeNull();
  });
});
