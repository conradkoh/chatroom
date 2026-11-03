import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileStoragePanel } from './FileStoragePanel';

const mocks = vi.hoisted(() => ({
  userStorage: vi.fn(),
  chatroomStorage: vi.fn(),
  setUserQuota: vi.fn(),
  setChatroomQuota: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = String(query);
    if (name === 'fileStorageSettings.getUserFileStorage') return mocks.userStorage();
    if (name === 'fileStorageSettings.getChatroomFileStorage') return mocks.chatroomStorage();
    return undefined;
  },
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    return name === 'setUserFileStorageQuota' ? mocks.setUserQuota : mocks.setChatroomQuota;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    fileStorageSettings: {
      getUserFileStorage: 'fileStorageSettings.getUserFileStorage',
      getChatroomFileStorage: 'fileStorageSettings.getChatroomFileStorage',
      setUserFileStorageQuota: 'fileStorageSettings.setUserFileStorageQuota',
      setChatroomFileStorageQuota: 'fileStorageSettings.setChatroomFileStorageQuota',
    },
  },
}));

vi.mock('sonner', () => {
  const toast = vi.fn();
  return { toast: Object.assign(toast, { success: vi.fn(), error: vi.fn() }) };
});

const MB = 1024 * 1024;
const GB = 1024 * MB;

function userStorage(
  overrides: {
    quotaBytes?: number;
    isDefault?: boolean;
    usageBytes?: number;
    fileCount?: number;
  } = {}
) {
  return {
    quotaBytes: overrides.quotaBytes ?? 1 * GB,
    isDefault: overrides.isDefault ?? true,
    platformMaxQuotaBytes: 5 * GB,
    usage: {
      bytes: overrides.usageBytes ?? 512 * MB,
      fileCount: overrides.fileCount ?? 3,
    },
  };
}

function renderUserPanel() {
  return render(<FileStoragePanel scope={{ kind: 'user' }} />);
}

function quotaInput(): HTMLInputElement {
  return screen.getByLabelText('Storage limit (MB)') as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
}

describe('FileStoragePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userStorage.mockReturnValue(userStorage());
    mocks.setUserQuota.mockResolvedValue({ quotaBytes: 1 * GB, evictionScheduled: false });
  });

  it('shows skeletons while the user storage query is loading', () => {
    mocks.userStorage.mockReturnValue(undefined);

    renderUserPanel();

    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(screen.queryByTestId('storage-usage')).not.toBeInTheDocument();
  });

  it('shows the usage text, percentage, and Default badge', () => {
    renderUserPanel();

    expect(screen.getByTestId('storage-usage').textContent).toContain(
      '512 MB of 1 GB used · 3 files'
    );
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('does not show the Default badge when the limit is custom', () => {
    mocks.userStorage.mockReturnValue(userStorage({ isDefault: false }));

    renderUserPanel();

    expect(screen.queryByText('Default')).not.toBeInTheDocument();
  });

  it('shows the range message and disables Save for invalid input', () => {
    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: 'abc' } });

    expect(screen.getByText('Enter a whole number from 0 to 5120.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('accepts 0 as a valid limit', () => {
    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: '0' } });

    expect(screen.queryByText('Enter a whole number from 0 to 5120.')).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('shows a server quota validation error inline', async () => {
    mocks.setUserQuota.mockRejectedValue({
      data: {
        code: 'VALIDATION_ERROR',
        message: 'Storage limit is too high.',
        fields: ['quotaBytes'],
      },
    });

    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: '2048' } });
    fireEvent.click(saveButton());

    expect(await screen.findByText('Storage limit is too high.')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows a toast for non-quota errors', async () => {
    mocks.setUserQuota.mockRejectedValue({
      data: { code: 'AUTH_FAILED', message: 'Nope' },
    });

    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: '2048' } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Your session expired. Sign in again.');
    });
  });

  it('asks for confirmation before lowering the limit below usage', async () => {
    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: '100' } });
    fireEvent.click(saveButton());

    expect(await screen.findByText('Lower the limit and remove files?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your account uses 512 MB. The new limit is 100 MB, so at least 412 MB of the oldest files will be removed in the background. Files still uploading are kept.'
      )
    ).toBeInTheDocument();
    expect(mocks.setUserQuota).not.toHaveBeenCalled();
  });

  it('does not save when the lower-limit dialog is cancelled', async () => {
    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: '100' } });
    fireEvent.click(saveButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(mocks.setUserQuota).not.toHaveBeenCalled();
  });

  it('saves after the lower-limit dialog is confirmed', async () => {
    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: '100' } });
    fireEvent.click(saveButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Lower limit' }));

    await waitFor(() => {
      expect(mocks.setUserQuota).toHaveBeenCalledWith({ quotaBytes: 100 * MB });
    });
    await waitFor(() => {
      expect(screen.queryByText('Lower the limit and remove files?')).not.toBeInTheDocument();
    });
  });

  it('shows the eviction toast when the server schedules eviction', async () => {
    mocks.setUserQuota.mockResolvedValue({
      quotaBytes: 2048 * MB,
      evictionScheduled: true,
    });

    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: '2048' } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Limit saved. Removing oldest files to fit.');
    });
  });

  it('shows the success toast when no eviction is needed', async () => {
    renderUserPanel();

    fireEvent.change(quotaInput(), { target: { value: '2048' } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Storage limit saved');
    });
  });

  it('shows the eviction banner while usage is over the limit and clears reactively', () => {
    mocks.userStorage.mockReturnValue(userStorage({ quotaBytes: 256 * MB, usageBytes: 512 * MB }));

    const { rerender } = renderUserPanel();

    expect(screen.getByRole('status')).toHaveTextContent(
      'Over the limit by 256 MB. Removing the oldest files in the background…'
    );

    mocks.userStorage.mockReturnValue(userStorage({ quotaBytes: 256 * MB, usageBytes: 128 * MB }));
    rerender(<FileStoragePanel scope={{ kind: 'user' }} />);

    expect(screen.queryByText(/Over the limit by/)).not.toBeInTheDocument();
  });

  it('shows one inline error with Retry and re-subscribes', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let failing = true;
    mocks.userStorage.mockImplementation(() => {
      if (failing) throw new Error('query failed');
      return userStorage();
    });

    renderUserPanel();

    expect(screen.getByText("Storage settings couldn't be loaded.")).toBeInTheDocument();

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('storage-usage')).toBeInTheDocument();
    expect(mocks.userStorage).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
