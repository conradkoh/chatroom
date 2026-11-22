import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProfilePage from './page';

const mocks = vi.hoisted(() => ({
  getOrCreateCode: vi.fn(),
  regenerateCode: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    auth: {
      getOrCreateRecoveryCode: 'auth:getOrCreateRecoveryCode',
      regenerateRecoveryCode: 'auth:regenerateRecoveryCode',
    },
    fileStorageSettings: {
      getUserFileStorage: 'fileStorageSettings.getUserFileStorage',
      setUserFileStorageQuota: 'fileStorageSettings.setUserFileStorageQuota',
    },
    fileAttachments: {
      listFiles: 'fileAttachments.listFiles',
      getFileUrls: 'fileAttachments.getFileUrls',
      deleteFile: 'fileAttachments.deleteFile',
      purgeFiles: 'fileAttachments.purgeFiles',
    },
  },
}));
// External ports: the Next.js router plus the Convex query/mutation boundaries.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('convex/react', () => ({
  useAction: (ref: string) =>
    ref === 'auth:getOrCreateRecoveryCode' ? mocks.getOrCreateCode : mocks.regenerateCode,
  usePaginatedQuery: () => ({
    results: [],
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1', vi.fn()],
  useSessionQuery: () => undefined,
  useSessionMutation: () => vi.fn(),
}));
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuthState: () => ({ state: 'authenticated', user: { _id: 'user1' } }),
}));
vi.mock('@/modules/auth/LoginCodeGenerator', () => ({ LoginCodeGenerator: () => null }));
vi.mock('@/modules/profile/NameEditForm', () => ({ NameEditForm: () => null }));
vi.mock('@/modules/theme/ThemeSettings', () => ({ ThemeSettings: () => null }));

const RECOVERY_CODE = 'ABCD-EFGH-IJKL';
const NEW_RECOVERY_CODE = 'WXYZ-1234-QRST';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getOrCreateCode.mockResolvedValue({ success: true, recoveryCode: RECOVERY_CODE });
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Reveals the recovery code and waits for the textarea to show it. */
async function revealCode() {
  fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Code' }));
  await screen.findByDisplayValue(RECOVERY_CODE);
}

describe('ProfilePage recovery feedback', () => {
  it('renders the file storage settings section', async () => {
    render(<ProfilePage />);

    expect(screen.getByRole('heading', { name: 'File Storage' })).toBeInTheDocument();
  });

  it('shows a retrieval failure as exactly one role=alert message', async () => {
    mocks.getOrCreateCode.mockResolvedValue({ success: false, reason: 'Code unavailable.' });
    render(<ProfilePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Code' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Code unavailable.');
    expect(alert).toHaveAttribute('data-testid', 'recovery-feedback');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('regenerate failure shows exactly one role=alert message', async () => {
    mocks.regenerateCode.mockResolvedValue({ success: false, reason: 'Regeneration failed.' });
    render(<ProfilePage />);
    await revealCode();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Regeneration failed.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('swaps to Check + Copied for 2 s after a successful copy, then reverts', async () => {
    vi.useFakeTimers();
    render(<ProfilePage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovery Code' }));
    });
    const copyButton = screen.getByRole('button', { name: 'Copy recovery code' });
    expect(copyButton.querySelector('.lucide-copy')).not.toBeNull();

    await act(async () => {
      fireEvent.click(copyButton);
    });
    expect(mocks.writeText).toHaveBeenCalledWith(RECOVERY_CODE);
    expect(copyButton).toHaveTextContent('Copied');
    expect(copyButton.querySelector('.lucide-check')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(copyButton).toHaveTextContent('Copy Code');
    expect(copyButton.querySelector('.lucide-copy')).not.toBeNull();
  });

  it('shows Failed to copy code. beside the button, and clears it on the next copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.writeText.mockRejectedValueOnce(new Error('denied'));
    render(<ProfilePage />);
    await revealCode();

    fireEvent.click(screen.getByRole('button', { name: 'Copy recovery code' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to copy code.');

    fireEvent.click(screen.getByRole('button', { name: 'Copy recovery code' }));

    expect(await screen.findByRole('button', { name: 'Copy recovery code' })).toHaveTextContent(
      'Copied'
    );
    expect(screen.queryByText('Failed to copy code.')).not.toBeInTheDocument();
  });

  it('regenerating the code clears a prior Failed to copy code. message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.writeText.mockRejectedValueOnce(new Error('denied'));
    mocks.regenerateCode.mockResolvedValue({ success: true, recoveryCode: NEW_RECOVERY_CODE });
    render(<ProfilePage />);
    await revealCode();

    fireEvent.click(screen.getByRole('button', { name: 'Copy recovery code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to copy code.');

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await screen.findByDisplayValue(NEW_RECOVERY_CODE);

    expect(screen.queryByText('Failed to copy code.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('regenerating the code resets a Copied state left over from the old code', async () => {
    mocks.regenerateCode.mockResolvedValue({ success: true, recoveryCode: NEW_RECOVERY_CODE });
    render(<ProfilePage />);
    await revealCode();

    fireEvent.click(screen.getByRole('button', { name: 'Copy recovery code' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy recovery code' })).toHaveTextContent('Copied')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await screen.findByDisplayValue(NEW_RECOVERY_CODE);

    expect(screen.getByRole('button', { name: 'Copy recovery code' })).toHaveTextContent(
      'Copy Code'
    );
    expect(
      screen.getByRole('button', { name: 'Copy recovery code' }).querySelector('.lucide-copy')
    ).not.toBeNull();
  });
});
