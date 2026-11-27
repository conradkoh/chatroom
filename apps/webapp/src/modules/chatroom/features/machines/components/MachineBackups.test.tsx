import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineBackups } from './MachineBackups';
import { BACKUP_EMPTY_COPY, BACKUP_NO_STACK_COPY, BACKUP_OFFLINE_COPY } from '../lib/backupCopy';

interface BackupRow {
  _id: string;
  kind: 'inventory' | 'download';
  status: string;
  createdAt: number;
  expiresAt: number;
  readyAt?: number;
  finishedAt?: number;
  preparingAt?: number;
  filename?: string;
  sizeBytes?: number;
  errorCode?: string;
  errorMessage?: string;
  inventoryDir?: string;
  stackFound?: boolean;
  backups?: { filename: string; sizeBytes: number; modifiedAt: number }[];
  totalCount?: number;
  totalBytes?: number;
  newestAt?: number;
  truncated?: boolean;
}

const MB = 1024 * 1024;
const INVENTORY_ID = 'inv-1';
const DOWNLOAD_ID = 'dl-1';
const SMALL = 'backup-20260301-141502.zip';
const LARGE = 'backup-20260227-090011.zip';
const SMALL_BYTES = 138 * MB;
const LARGE_BYTES = 300 * MB;
const HOUR_MS = 60 * 60_000;

const mocks = vi.hoisted(() => ({
  rows: new Map<string, BackupRow | null>(),
  active: null as BackupRow | null,
  createInventory: vi.fn(),
  createDownload: vi.fn(),
  createAccess: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  stream: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args?: { requestId?: string } | 'skip') => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name === 'machineBackups:getRequest') {
      if (args === 'skip') return undefined;
      const requestId = (args as { requestId: string }).requestId;
      return mocks.rows.has(requestId) ? mocks.rows.get(requestId) : undefined;
    }
    if (name === 'machineBackups:getActiveDownload') return mocks.active;
    throw new Error(`Unexpected query: ${name}`);
  },
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    if (name === 'machineBackups:createInventoryRequest') return mocks.createInventory;
    if (name === 'machineBackups:createDownloadRequest') return mocks.createDownload;
    if (name === 'machineBackups:createDownloadAccess') return mocks.createAccess;
    if (name === 'machineBackups:writeDownloadConfirmation') return mocks.confirm;
    if (name === 'machineBackups:cancelRequest') return mocks.cancel;
    throw new Error(`Unexpected mutation: ${name}`);
  },
}));

vi.mock('../../transfer/lib/downloadBackupStream', () => ({
  downloadBackupStream: (args: unknown) => mocks.stream(args),
}));

vi.mock('@/modules/chatroom/lib/messageExport/downloadTextFile', () => ({
  downloadBlobFile: (filename: string, blob: Blob) => mocks.saveFile(filename, blob),
}));

let now = Date.now();

function inventoryReady(overrides: Partial<BackupRow> = {}): BackupRow {
  return {
    _id: INVENTORY_ID,
    kind: 'inventory',
    status: 'completed',
    createdAt: now,
    expiresAt: now + HOUR_MS,
    readyAt: now,
    finishedAt: now,
    stackFound: true,
    inventoryDir: '/repo/services/backend/.convex/user-backups',
    backups: [
      { filename: SMALL, sizeBytes: SMALL_BYTES, modifiedAt: now - 2 * HOUR_MS },
      { filename: LARGE, sizeBytes: LARGE_BYTES, modifiedAt: now - 4 * HOUR_MS },
    ],
    totalCount: 2,
    totalBytes: SMALL_BYTES + LARGE_BYTES,
    newestAt: now - 2 * HOUR_MS,
    truncated: false,
    ...overrides,
  };
}

function downloadRow(status: string, overrides: Partial<BackupRow> = {}): BackupRow {
  return {
    _id: DOWNLOAD_ID,
    kind: 'download',
    status,
    filename: SMALL,
    sizeBytes: SMALL_BYTES,
    createdAt: now,
    expiresAt: now + HOUR_MS,
    ...overrides,
  };
}

function setRow(row: BackupRow): void {
  mocks.rows.set(row._id, row);
  mocks.active = row;
}

function renderSection(props: { connected: boolean | undefined } = { connected: true }) {
  return render(
    <MachineBackups machineId="machine-1" displayName="MacBook Pro" connected={props.connected} />
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Seed a completed inventory and press Check backups. */
async function loadInventory(row: BackupRow = inventoryReady()) {
  mocks.rows.set(INVENTORY_ID, row);
  mocks.createInventory.mockResolvedValue({ requestId: INVENTORY_ID, reused: false });
  fireEvent.click(screen.getByTestId('backups-check'));
  await flush();
}

describe('MachineBackups', () => {
  beforeEach(() => {
    now = Date.now();
    mocks.rows = new Map();
    mocks.active = null;
    mocks.createInventory.mockReset();
    mocks.createDownload.mockReset();
    mocks.createAccess.mockReset();
    mocks.confirm.mockReset();
    mocks.cancel.mockReset();
    mocks.stream.mockReset();
    mocks.saveFile.mockReset();
    mocks.createDownload.mockResolvedValue({ requestId: DOWNLOAD_ID, reused: false });
    mocks.confirm.mockResolvedValue({ ok: true });
    mocks.cancel.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the offline copy and a disabled Check backups button', () => {
    renderSection({ connected: false });

    expect(screen.getByText(BACKUP_OFFLINE_COPY)).toBeInTheDocument();
    expect(screen.getByTestId('backups-check')).toBeDisabled();
  });

  it('shows Checking connection… while connectivity is unresolved', () => {
    renderSection({ connected: undefined });

    expect(screen.getByText('Checking connection…')).toBeInTheDocument();
    expect(screen.getByTestId('backups-check')).toBeDisabled();
  });

  it('asks the daemon without inventing a request on mount', async () => {
    renderSection();

    expect(mocks.createInventory).not.toHaveBeenCalled();
    expect(screen.getByTestId('backups-check')).toBeEnabled();

    await loadInventory();

    expect(mocks.createInventory).toHaveBeenCalledWith({ machineId: 'machine-1' });
  });

  it('shows the asking state while the request row loads', async () => {
    mocks.createInventory.mockResolvedValue({ requestId: 'pending-1', reused: false });
    renderSection();

    fireEvent.click(screen.getByTestId('backups-check'));
    await flush();

    expect(screen.getByTestId('backups-asking')).toBeInTheDocument();
    expect(screen.getByText('Asking daemon…')).toBeInTheDocument();
    expect(screen.getByText('Waiting for MacBook Pro to list its backups.')).toBeInTheDocument();
  });

  it('renders the ready snapshot with count, summary, directory, rows and As of', async () => {
    renderSection();
    await loadInventory();

    expect(screen.getByTestId('backups-count')).toHaveTextContent('2 backups');
    expect(screen.getByTestId('backups-summary')).toHaveTextContent(
      '2 backups · newest 2 hours ago · 438 MB total'
    );
    expect(screen.getByTestId('backups-as-of')).toHaveTextContent(/^As of /);
    expect(screen.getByTestId('backups-directory')).toHaveTextContent(
      '/repo/services/backend/.convex/user-backups'
    );
    expect(within(screen.getByTestId('backups-directory')).getByRole('button')).toBeInTheDocument();

    const rows = screen.getAllByTestId('backup-row');
    expect(rows.map((row) => row.getAttribute('data-filename'))).toEqual([SMALL, LARGE]);
    expect(within(rows[0]).getByText(/· 138 MB$/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/· 300 MB$/)).toBeInTheDocument();
  });

  it('shows the truncation note and the previous list during a refresh', async () => {
    mocks.createInventory.mockResolvedValue({ requestId: INVENTORY_ID, reused: false });
    renderSection();
    await loadInventory(inventoryReady({ truncated: true, totalCount: 312 }));

    expect(screen.getByTestId('backups-truncated')).toHaveTextContent(
      'Showing the newest 2 of 312 backups.'
    );

    mocks.createInventory.mockResolvedValue({ requestId: 'inv-2', reused: false });
    fireEvent.click(screen.getByTestId('backups-refresh'));
    await flush();

    expect(screen.getByTestId('backups-ready')).toBeInTheDocument();
    expect(screen.getByTestId('backups-refresh')).toHaveTextContent('Asking daemon…');
    expect(screen.getByTestId('backups-refresh')).toBeDisabled();
  });

  it('explains a machine with no local stack', async () => {
    renderSection();
    await loadInventory(inventoryReady({ stackFound: false, backups: [] }));

    expect(screen.getByText(BACKUP_NO_STACK_COPY)).toBeInTheDocument();
    expect(screen.getByTestId('backups-refresh')).toHaveTextContent('Check again');
  });

  it('shows the empty copy, help and directory', async () => {
    renderSection();
    await loadInventory(inventoryReady({ backups: [], totalCount: 0, totalBytes: 0 }));

    expect(screen.getByText(BACKUP_EMPTY_COPY)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Create one from the Convex Backups panel in the local dashboard on that machine.'
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId('backups-directory')).toBeInTheDocument();
  });

  it('shows the failed notice with Try again', async () => {
    mocks.rows.set(INVENTORY_ID, inventoryReady({ status: 'failed', errorCode: 'daemon_timeout' }));
    mocks.createInventory.mockResolvedValue({ requestId: INVENTORY_ID, reused: false });
    renderSection();

    fireEvent.click(screen.getByTestId('backups-check'));
    await flush();

    expect(screen.getByTestId('backups-failed')).toHaveTextContent(
      /Could not read backups: The daemon did not respond/
    );
    fireEvent.click(screen.getByTestId('backups-retry'));
    await flush();
    expect(mocks.createInventory).toHaveBeenCalledTimes(2);
  });

  it('flips a requested inventory to timed out at its expiresAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.rows.set(INVENTORY_ID, inventoryReady({ status: 'requested', expiresAt: now + 10_000 }));
    mocks.createInventory.mockResolvedValue({ requestId: INVENTORY_ID, reused: false });
    renderSection();

    fireEvent.click(screen.getByTestId('backups-check'));
    await flush();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByTestId('backups-timed-out')).toHaveTextContent('The daemon did not respond');
    expect(screen.getByTestId('backups-retry')).toHaveTextContent('Try again');
  });

  it('disables downloads while offline and marks an over-limit archive', async () => {
    const { rerender } = renderSection();
    await loadInventory();

    rerender(<MachineBackups machineId="machine-1" displayName="MacBook Pro" connected={false} />);

    expect(
      screen.getAllByTestId('backup-download').every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
    expect(
      screen.getByText('Larger than the 256 MB download limit. Copy it from the machine directly.')
    ).toBeInTheDocument();
  });

  it('disables the other rows while a download is active', async () => {
    setRow(downloadRow('ready'));
    renderSection();
    await loadInventory();

    expect(screen.getAllByTestId('backup-download')[0]).toHaveTextContent('In progress');
    expect(screen.getAllByTestId('backup-download')[1]).toBeDisabled();
  });

  it('warns before downloading, focuses Cancel and names the machine', async () => {
    const user = userEvent.setup();
    mocks.rows.set(DOWNLOAD_ID, downloadRow('requested'));
    renderSection();
    await loadInventory();

    await user.click(screen.getAllByTestId('backup-download')[0]);

    const dialog = await screen.findByTestId('backup-warning-dialog');
    expect(within(dialog).getByText(/bot tokens/)).toBeInTheDocument();
    expect(within(dialog).getByText(/MacBook Pro/)).toBeInTheDocument();

    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());

    await user.click(within(dialog).getByTestId('backup-warning-confirm'));

    expect(mocks.createDownload).toHaveBeenCalledWith({ machineId: 'machine-1', filename: SMALL });
    expect(await screen.findByTestId('backup-download-status')).toHaveAttribute(
      'data-state',
      'requested'
    );
  });

  it('hides Try again for a too_large download failure', async () => {
    setRow(downloadRow('failed', { errorCode: 'too_large' }));
    renderSection();
    await loadInventory();

    expect(screen.getByTestId('backup-download-status')).toHaveAttribute('data-state', 'failed');
    expect(
      screen.getByText('This backup is larger than the 256 MB download limit.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('shows the expired copy with Request again', async () => {
    setRow(downloadRow('expired'));
    renderSection();
    await loadInventory();

    expect(screen.getByTestId('backup-download-status')).toHaveAttribute('data-state', 'expired');
    expect(screen.getByText('Request again')).toBeInTheDocument();
  });

  it('shows the cancelled copy and dismisses the terminal block', async () => {
    setRow(downloadRow('cancelled'));
    renderSection();
    await loadInventory();

    expect(screen.getByText(/Cancelled\. The temporary copy was deleted\./)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByTestId('backup-download-status')).toBeNull();
  });

  it('cancels a prepared copy through cancelRequest', async () => {
    setRow(downloadRow('ready'));
    renderSection();
    await loadInventory();

    fireEvent.click(screen.getByText('Discard copy'));
    await flush();

    expect(mocks.cancel).toHaveBeenCalledWith({ requestId: DOWNLOAD_ID });
  });
});

describe('MachineBackups download lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.rows = new Map();
    mocks.active = null;
    mocks.createInventory.mockReset();
    mocks.createDownload.mockReset();
    mocks.createAccess.mockReset();
    mocks.confirm.mockReset();
    mocks.cancel.mockReset();
    mocks.stream.mockReset();
    mocks.saveFile.mockReset();
    mocks.createInventory.mockResolvedValue({ requestId: INVENTORY_ID, reused: false });
    mocks.createDownload.mockResolvedValue({ requestId: DOWNLOAD_ID, reused: false });
    mocks.createAccess.mockResolvedValue({
      ok: true,
      url: 'https://storage.example/temporary-copy',
      sizeBytes: SMALL_BYTES,
      filename: SMALL,
    });
    mocks.confirm.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Load the snapshot, then open the warning and confirm it; ends on the Requested view. */
  async function openRequested() {
    const view = renderSection();
    await loadInventory();
    fireEvent.click(screen.getAllByTestId('backup-download')[0]);
    fireEvent.click(screen.getByTestId('backup-warning-confirm'));
    setRow(downloadRow('requested'));
    await flush();
    return view;
  }

  it('runs Requested → Preparing → Ready → Downloading → Done', async () => {
    let resolveStream: (value: unknown) => void = () => {};
    mocks.stream.mockImplementation(
      (args: { onProgress?: (n: number) => void }) =>
        new Promise((resolve) => {
          args.onProgress?.(84 * MB);
          resolveStream = resolve;
        })
    );

    const { rerender } = await openRequested();
    expect(screen.getByTestId('backup-download-status')).toHaveAttribute('data-state', 'requested');
    expect(
      screen.getByText('Requested · waiting for the daemon to pick it up')
    ).toBeInTheDocument();

    act(() => {
      setRow(downloadRow('preparing', { preparingAt: now, sizeBytes: SMALL_BYTES }));
      rerender(<MachineBackups machineId="machine-1" displayName="MacBook Pro" connected />);
    });

    expect(screen.getByTestId('backup-download-status')).toHaveAttribute('data-state', 'preparing');
    expect(screen.getByText('Preparing on MacBook Pro')).toBeInTheDocument();
    expect(
      screen.getByText('The daemon is uploading a temporary copy (138 MB).')
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(42_000);
    });
    expect(screen.getByText('0:42')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(
      screen.getByTestId('backup-download-status').querySelector('[aria-live="off"]')
    ).not.toBeNull();

    act(() => {
      setRow(
        downloadRow('ready', {
          sizeBytes: SMALL_BYTES,
          expiresAt: now + 58 * 60_000,
        })
      );
      rerender(<MachineBackups machineId="machine-1" displayName="MacBook Pro" connected />);
    });

    expect(screen.getByText('Ready to save')).toBeInTheDocument();
    expect(screen.getByText('expires in 58 min')).toBeInTheDocument();
    expect(screen.getByText('Save file')).toBeInTheDocument();
    expect(screen.getByText('Discard copy')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Save file'));
    act(() => {
      setRow(
        downloadRow('downloading', {
          sizeBytes: SMALL_BYTES,
          expiresAt: now + 58 * 60_000,
        })
      );
      rerender(<MachineBackups machineId="machine-1" displayName="MacBook Pro" connected />);
    });
    await flush();

    expect(screen.getByTestId('backup-download-status')).toHaveAttribute(
      'data-state',
      'downloading'
    );
    expect(screen.getByText('84 MB of 138 MB')).toBeInTheDocument();
    expect(screen.getByLabelText('Download progress')).toBeInTheDocument();

    await act(async () => {
      resolveStream({ ok: true, blob: new Blob(['backup']) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.saveFile).toHaveBeenCalledWith(SMALL, expect.any(Blob));
    expect(mocks.confirm).toHaveBeenCalledWith({
      requestId: DOWNLOAD_ID,
      receivedBytes: SMALL_BYTES,
    });

    act(() => {
      setRow(downloadRow('downloaded', { sizeBytes: SMALL_BYTES }));
      rerender(<MachineBackups machineId="machine-1" displayName="MacBook Pro" connected />);
    });

    expect(screen.getByTestId('backup-download-status')).toHaveAttribute('data-state', 'done');
    expect(screen.getByText(/Saved backup-20260301-141502\.zip \(138 MB\)/)).toBeInTheDocument();
    expect(screen.getByText(/The backup on MacBook Pro is unchanged/)).toBeInTheDocument();
  });

  it('shows the downloaded-size copy when the stream is short', async () => {
    setRow(downloadRow('ready', { sizeBytes: SMALL_BYTES, expiresAt: now + HOUR_MS }));
    mocks.stream.mockResolvedValue({ ok: false, reason: 'size_mismatch', received: 3 });
    renderSection();
    await loadInventory();

    fireEvent.click(screen.getByText('Save file'));
    await flush();

    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(screen.getByText('Download failed')).toBeInTheDocument();
    expect(
      screen.getByText('The downloaded size did not match the backup. Try again.')
    ).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});
