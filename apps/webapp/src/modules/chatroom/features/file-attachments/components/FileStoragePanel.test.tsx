import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileStoragePanel } from './FileStoragePanel';

const mocks = vi.hoisted(() => ({
  userStorage: vi.fn(),
  chatroomStorage: vi.fn(),
  setUserQuota: vi.fn(),
  setChatroomQuota: vi.fn(),
  listFiles: vi.fn(),
  firstLargest: vi.fn(),
  getFileUrls: vi.fn(),
  deleteFile: vi.fn(),
  purgeFiles: vi.fn(),
}));

vi.mock('convex/react', () => {
  const emptyPage = () => ({
    results: [],
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
  });
  return {
    usePaginatedQuery: (query: unknown, args: unknown, opts: { initialNumItems: number }) => {
      if (args === 'skip') return emptyPage();
      const name = String(query).split('.').pop();
      if (name !== 'listFiles') return emptyPage();
      return opts.initialNumItems === 1 ? mocks.firstLargest() : mocks.listFiles();
    },
  };
});

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1', vi.fn()],
  useSessionQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = String(query);
    if (name === 'fileStorageSettings.getUserFileStorage') return mocks.userStorage();
    if (name === 'fileStorageSettings.getChatroomFileStorage') return mocks.chatroomStorage();
    if (name.endsWith('getFileUrls')) return mocks.getFileUrls();
    return undefined;
  },
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    if (name === 'setUserFileStorageQuota') return mocks.setUserQuota;
    if (name === 'setChatroomFileStorageQuota') return mocks.setChatroomQuota;
    if (name === 'deleteFile') return mocks.deleteFile;
    if (name === 'purgeFiles') return mocks.purgeFiles;
    return vi.fn();
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
    fileAttachments: {
      listFiles: 'fileAttachments.listFiles',
      getFileUrls: 'fileAttachments.getFileUrls',
      deleteFile: 'fileAttachments.deleteFile',
      purgeFiles: 'fileAttachments.purgeFiles',
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

type FileListTestItem = {
  _id: string;
  chatroomId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

function paginationState(
  results: FileListTestItem[],
  status: 'LoadingFirstPage' | 'LoadingMore' | 'CanLoadMore' | 'Exhausted'
) {
  return { results, status, loadMore: vi.fn(), isLoading: status === 'LoadingFirstPage' };
}

function makeFile(index: number, sizeBytes: number): FileListTestItem {
  return {
    _id: `jd7testfile${index}`,
    chatroomId: 'jd7testchatroom0000000000000001',
    filename: `file-${index}.png`,
    mimeType: 'image/png',
    sizeBytes,
  };
}

function renderUserPanel() {
  return render(<FileStoragePanel scope={{ kind: 'user' }} />);
}

function purgeButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Purge files…' }) as HTMLButtonElement;
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
    mocks.listFiles.mockReturnValue(paginationState([], 'Exhausted'));
    mocks.firstLargest.mockReturnValue(paginationState([], 'Exhausted'));
    mocks.getFileUrls.mockReturnValue([]);
    mocks.deleteFile.mockResolvedValue({ deleted: true });
    mocks.purgeFiles.mockResolvedValue({ deleted: 0, continuing: false });
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

  it('disables the purge button when the scope has no files', () => {
    mocks.userStorage.mockReturnValue(userStorage({ usageBytes: 0, fileCount: 0 }));

    renderUserPanel();

    expect(purgeButton()).toBeDisabled();
  });

  it('renders the shared file list inside the panel', () => {
    mocks.listFiles.mockReturnValue(paginationState([makeFile(1, 2 * MB)], 'Exhausted'));

    renderUserPanel();

    expect(screen.getByTestId('file-attachment-row').textContent).toContain('file-1.png');
  });

  it('shows the purge-in-progress banner and clears to a finished toast reactively', async () => {
    mocks.listFiles.mockReturnValue(
      paginationState([makeFile(1, 2 * MB), makeFile(2, 2 * MB), makeFile(3, 2 * MB)], 'Exhausted')
    );
    mocks.firstLargest.mockReturnValue(paginationState([makeFile(1, 5 * MB)], 'Exhausted'));
    mocks.purgeFiles.mockResolvedValue({ deleted: 3, continuing: true });

    const { rerender } = renderUserPanel();

    fireEvent.click(purgeButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 files' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Purge in progress. 3 files deleted so far…'
    );
    expect(mocks.purgeFiles).toHaveBeenCalledWith({
      chatroomId: undefined,
      minSizeBytes: undefined,
    });

    mocks.firstLargest.mockReturnValue(paginationState([], 'Exhausted'));
    rerender(<FileStoragePanel scope={{ kind: 'user' }} />);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Purge finished');
    });
    expect(screen.queryByText(/Purge in progress/)).not.toBeInTheDocument();
  });
});
