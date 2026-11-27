import { act, renderHook } from '@testing-library/react';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMachineBackups } from './useMachineBackups';

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

const BASE = new Date('2026-11-27T12:00:00Z').getTime();
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

function inventoryRow(overrides: Partial<BackupRow> = {}): BackupRow {
  return {
    _id: 'req-1',
    kind: 'inventory',
    status: 'completed',
    createdAt: BASE,
    expiresAt: BASE + HOUR_MS,
    readyAt: BASE,
    finishedAt: BASE,
    stackFound: true,
    inventoryDir: '/e2e/backups',
    backups: [
      { filename: 'backup-20260301-141502.zip', sizeBytes: 30, modifiedAt: BASE - HOUR_MS },
    ],
    totalCount: 1,
    totalBytes: 30,
    newestAt: BASE - HOUR_MS,
    truncated: false,
    ...overrides,
  };
}

function downloadRow(overrides: Partial<BackupRow> = {}): BackupRow {
  return {
    _id: 'dl-1',
    kind: 'download',
    status: 'requested',
    filename: 'backup-20260301-141502.zip',
    createdAt: BASE,
    expiresAt: BASE + HOUR_MS,
    ...overrides,
  };
}

function setRow(row: BackupRow, active = false): void {
  mocks.rows.set(row._id, row);
  mocks.active = active ? row : null;
}

function renderBackups(props: { connected: boolean | undefined } = { connected: true }) {
  return renderHook(
    ({ gate }: { gate: boolean | undefined }) =>
      useMachineBackups('machine-1', { connected: gate }),
    {
      initialProps: { gate: props.connected },
    }
  );
}

describe('useMachineBackups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    mocks.rows = new Map();
    mocks.active = null;
    mocks.createInventory.mockReset();
    mocks.createDownload.mockReset();
    mocks.createAccess.mockReset();
    mocks.confirm.mockReset();
    mocks.cancel.mockReset();
    mocks.stream.mockReset();
    mocks.saveFile.mockReset();
    mocks.createInventory.mockResolvedValue({ requestId: 'req-1', reused: false });
    mocks.createDownload.mockResolvedValue({ requestId: 'dl-1', reused: false });
    mocks.cancel.mockResolvedValue({ ok: true });
    mocks.confirm.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gates the idle view on connectivity', () => {
    const online = renderBackups();
    expect(online.result.current.inventory).toEqual({ kind: 'idle', canAsk: true });
    online.unmount();

    const offline = renderBackups({ connected: false });
    expect(offline.result.current.inventory).toEqual({
      kind: 'idle',
      canAsk: false,
      blockedBy: 'offline',
    });
    offline.unmount();

    const connecting = renderBackups({ connected: undefined });
    expect(connecting.result.current.inventory).toEqual({
      kind: 'idle',
      canAsk: false,
      blockedBy: 'connecting',
    });
  });

  it('creates an inventory request, asks while loading, then maps the completed row', async () => {
    const { result, rerender } = renderBackups();

    await act(async () => {
      await result.current.refresh();
    });
    expect(mocks.createInventory).toHaveBeenCalledWith({ machineId: 'machine-1' });
    expect(result.current.inventory).toEqual({ kind: 'asking', hasPrevious: false });

    act(() => {
      mocks.rows.set('req-1', inventoryRow({ truncated: true, totalCount: 312 }));
      rerender({ gate: true });
    });

    expect(result.current.inventory).toEqual({
      kind: 'ready',
      requestId: 'req-1',
      asOf: BASE,
      stackFound: true,
      inventoryDir: '/e2e/backups',
      backups: [
        { filename: 'backup-20260301-141502.zip', sizeBytes: 30, modifiedAt: BASE - HOUR_MS },
      ],
      totalCount: 312,
      totalBytes: 30,
      newestAt: BASE - HOUR_MS,
      truncated: true,
    });

    // A second refresh keeps the previous snapshot flag but loads the new request.
    mocks.createInventory.mockResolvedValue({ requestId: 'req-2', reused: false });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.inventory).toEqual({ kind: 'asking', hasPrevious: true });
  });

  it('turns a requested row into timedOut once expiresAt passes', async () => {
    mocks.rows.set('req-1', inventoryRow({ status: 'requested', expiresAt: BASE + 10_000 }));
    const { result } = renderBackups();

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.inventory).toEqual({ kind: 'asking', hasPrevious: false });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.inventory).toEqual({ kind: 'timedOut' });
  });

  it('maps a failed inventory row to its daemon copy', async () => {
    mocks.rows.set('req-1', inventoryRow({ status: 'failed', errorCode: 'daemon_timeout' }));
    const { result } = renderBackups();

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.inventory).toEqual({
      kind: 'failed',
      message: 'The daemon did not respond. It may need updating, or it went offline.',
    });
  });

  it('tracks a download from requested through preparing to ready', async () => {
    const filename = 'backup-20260301-141502.zip';
    const { result, rerender } = renderBackups();

    await act(async () => {
      await result.current.requestDownload(filename);
    });
    expect(mocks.createDownload).toHaveBeenCalledWith({ machineId: 'machine-1', filename });
    expect(result.current.download.kind).toBe('none');

    act(() => {
      setRow(downloadRow(), true);
      rerender({ gate: true });
    });
    expect(result.current.download).toEqual({ kind: 'requested', requestId: 'dl-1', filename });
    expect(result.current.activeFilename).toBe(filename);

    act(() => {
      setRow(downloadRow({ status: 'preparing', preparingAt: BASE, sizeBytes: 138 }));
      rerender({ gate: true });
    });
    expect(result.current.download).toEqual({
      kind: 'preparing',
      requestId: 'dl-1',
      filename,
      sizeBytes: 138,
      preparingAt: BASE,
    });

    act(() => {
      setRow(downloadRow({ status: 'ready', sizeBytes: 138, expiresAt: BASE + HOUR_MS }));
      rerender({ gate: true });
    });
    expect(result.current.download).toEqual({
      kind: 'ready',
      requestId: 'dl-1',
      filename,
      sizeBytes: 138,
      expiresAt: BASE + HOUR_MS,
    });
  });

  it('saves the stream, confirms receipt and reaches done', async () => {
    const filename = 'backup-20260301-141502.zip';
    const readyRow = downloadRow({ status: 'ready', sizeBytes: 6, expiresAt: BASE + HOUR_MS });
    mocks.createAccess.mockResolvedValue({
      ok: true,
      url: 'https://storage.example/temporary-copy',
      sizeBytes: 6,
      filename,
    });
    mocks.stream.mockImplementation(async (args: { onProgress?: (n: number) => void }) => {
      args.onProgress?.(3);
      args.onProgress?.(6);
      return { ok: true, blob: new Blob(['abcdef']) };
    });

    const { result, rerender } = renderBackups();
    await act(async () => {
      await result.current.requestDownload(filename);
    });
    act(() => {
      setRow(readyRow, true);
      rerender({ gate: true });
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mocks.createAccess).toHaveBeenCalledWith({ requestId: 'dl-1' });
    expect(mocks.stream).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://storage.example/temporary-copy', expectedBytes: 6 })
    );
    expect(mocks.saveFile).toHaveBeenCalledWith(filename, expect.any(Blob));
    expect(mocks.confirm).toHaveBeenCalledWith({ requestId: 'dl-1', receivedBytes: 6 });
    expect(JSON.stringify(result.current)).not.toContain('storage.example');

    act(() => {
      setRow(downloadRow({ status: 'downloaded', sizeBytes: 6 }), false);
      rerender({ gate: true });
    });
    expect(result.current.download).toEqual({
      kind: 'done',
      requestId: 'dl-1',
      filename,
      sizeBytes: 6,
    });
  });

  it('fails with the downloaded-size copy when the stream is short', async () => {
    const filename = 'backup-20260301-141502.zip';
    setRow(downloadRow({ status: 'ready', sizeBytes: 6, expiresAt: BASE + HOUR_MS }), true);
    mocks.createAccess.mockResolvedValue({
      ok: true,
      url: 'https://storage.example/temporary-copy',
      sizeBytes: 6,
      filename,
    });
    mocks.stream.mockResolvedValue({ ok: false, reason: 'size_mismatch', received: 3 });

    const { result } = renderBackups();

    await act(async () => {
      await result.current.save();
    });

    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(result.current.download).toEqual({
      kind: 'failed',
      requestId: 'dl-1',
      filename,
      code: 'download_size_mismatch',
      message: 'The downloaded size did not match the backup. Try again.',
      retryable: true,
    });
  });

  it('cancels a ready copy through the server row', async () => {
    setRow(downloadRow({ status: 'ready', sizeBytes: 6, expiresAt: BASE + HOUR_MS }), true);
    const { result } = renderBackups();

    await act(async () => {
      await result.current.cancel();
    });

    expect(mocks.cancel).toHaveBeenCalledWith({ requestId: 'dl-1' });
  });

  it('aborts an in-flight stream when cancelled', async () => {
    const filename = 'backup-20260301-141502.zip';
    setRow(downloadRow({ status: 'ready', sizeBytes: 6, expiresAt: BASE + HOUR_MS }), true);
    mocks.createAccess.mockResolvedValue({
      ok: true,
      url: 'https://storage.example/temporary-copy',
      sizeBytes: 6,
      filename,
    });

    let capturedSignal: AbortSignal | undefined;
    mocks.stream.mockImplementation(
      (args: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          capturedSignal = args.signal;
          args.signal?.addEventListener('abort', () =>
            resolve({ ok: false, reason: 'aborted', received: 0 })
          );
        })
    );

    const { result } = renderBackups();

    let savingPromise: Promise<void> | undefined;
    await act(async () => {
      savingPromise = result.current.save();
      await Promise.resolve();
    });
    expect(result.current.saving).toBe(true);

    await act(async () => {
      await result.current.cancel();
    });
    await act(async () => {
      await savingPromise;
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(mocks.cancel).toHaveBeenCalledWith({ requestId: 'dl-1' });
    expect(result.current.saving).toBe(false);
    expect(result.current.download.kind).toBe('ready');
  });

  it('shows the machine copy when the server rejects a concurrent download', async () => {
    mocks.createDownload.mockRejectedValue({
      data: { code: 'BACKUP_REQUEST_ACTIVE', message: 'Another backup is being prepared' },
    });
    const { result } = renderBackups();

    await act(async () => {
      await result.current.requestDownload('backup-20260301-141502.zip');
    });

    expect(result.current.download).toEqual({
      kind: 'failed',
      requestId: null,
      filename: 'backup-20260301-141502.zip',
      code: 'BACKUP_REQUEST_ACTIVE',
      message: 'Another backup download is already in progress on this machine.',
      retryable: true,
    });
  });

  it('marks the idle view offline when the server rejects the request', async () => {
    mocks.createInventory.mockRejectedValue({ data: { code: 'MACHINE_OFFLINE' } });
    const { result } = renderBackups();

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.inventory).toEqual({
      kind: 'idle',
      canAsk: true,
      blockedBy: 'offline',
    });
  });
});
