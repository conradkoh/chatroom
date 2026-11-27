'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { FunctionReturnType } from 'convex/server';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import { downloadBackupStream } from '../../transfer/lib/downloadBackupStream';
import { backupFailureCopy } from '../lib/backupCopy';
import { getConvexErrorCode, getMachineErrorCopy } from '../lib/machineErrorCopy';
import { useNow } from '../lib/useNow';

import { downloadBlobFile } from '@/modules/chatroom/lib/messageExport/downloadTextFile';

type RequestId = Id<'chatroom_machineBackupRequests'>;
type BackupRowView = NonNullable<FunctionReturnType<typeof api.machineBackups.getRequest>>;

export type BackupInventoryView =
  | { kind: 'idle'; canAsk: boolean; blockedBy?: 'offline' | 'connecting' }
  | { kind: 'asking'; hasPrevious: boolean }
  | { kind: 'timedOut' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'ready';
      requestId: string;
      asOf: number;
      stackFound: boolean;
      inventoryDir: string | null;
      backups: { filename: string; sizeBytes: number; modifiedAt: number }[];
      totalCount: number;
      totalBytes: number;
      newestAt: number | null;
      truncated: boolean;
    };

export type BackupDownloadView =
  | { kind: 'none' }
  | { kind: 'requested'; requestId: string; filename: string }
  | {
      kind: 'preparing';
      requestId: string;
      filename: string;
      sizeBytes: number | null;
      preparingAt: number;
    }
  | { kind: 'ready'; requestId: string; filename: string; sizeBytes: number; expiresAt: number }
  | {
      kind: 'downloading';
      requestId: string;
      filename: string;
      sizeBytes: number;
      receivedBytes: number;
    }
  | { kind: 'done'; requestId: string; filename: string; sizeBytes: number }
  | { kind: 'cancelled'; requestId: string; filename: string }
  | { kind: 'expired'; requestId: string; filename: string }
  | {
      kind: 'failed';
      requestId: string | null;
      filename: string;
      code: string;
      message: string;
      retryable: boolean;
    };

export interface UseMachineBackupsResult {
  inventory: BackupInventoryView;
  download: BackupDownloadView;
  /** The machine's active download filename, whoever started it; null when none. */
  activeFilename: string | null;
  /** True from the Save click until the stream or its failure settles. */
  saving: boolean;
  refresh(): Promise<void>;
  /** Named `requestDownload` because `download` is already the view (the design's names collide). */
  requestDownload(filename: string): Promise<void>;
  save(): Promise<void>;
  cancel(): Promise<void>;
}

export interface BackupGate {
  /** Raw connectivity; undefined while unresolved. */
  connected?: boolean | undefined;
}

type FailureView = Extract<BackupDownloadView, { kind: 'failed' }>;

const MACHINE_OFFLINE_CODE = 'MACHINE_OFFLINE';
const UNKNOWN_CODE = 'unknown';
const REQUEST_FALLBACK_COPY = 'Could not check backups. Try again.';
const READ_FALLBACK_COPY = 'Could not read backups. Try again.';
const REQUEST_DOWNLOAD_FALLBACK_COPY = 'Could not prepare the download. Try again.';
const CONFIRM_ATTEMPTS = 3;
const CONFIRM_FAILED_COPY =
  'The backup was saved, but the temporary cloud copy could not be removed. It expires within an hour.';
const NOT_READY_COPY = 'The backup is not ready yet. Try again.';
const TICK_MS = 30_000;

function idleBlockedBy(
  connected: boolean | undefined,
  offlineRejected: boolean
): 'offline' | 'connecting' | undefined {
  if (connected === false || offlineRejected) return 'offline';
  if (connected === undefined) return 'connecting';
  return undefined;
}

function idleView(connected: boolean | undefined, offlineRejected: boolean): BackupInventoryView {
  const blockedBy = idleBlockedBy(connected, offlineRejected);
  return blockedBy === undefined
    ? { kind: 'idle', canAsk: connected === true }
    : { kind: 'idle', canAsk: connected === true, blockedBy };
}

/** Daemon copy for a failed row, falling back to its message only when the code is unknown. */
function rowFailureMessage(row: BackupRowView): string {
  const code = row.errorCode ?? UNKNOWN_CODE;
  if (code === UNKNOWN_CODE && row.errorMessage) return row.errorMessage;
  return backupFailureCopy(code).message;
}

// fallow-ignore-next-line complexity
function inventoryReadyView(row: BackupRowView, requestId: RequestId): BackupInventoryView {
  const backups = row.backups ?? [];
  return {
    kind: 'ready',
    requestId,
    asOf: row.readyAt ?? row.finishedAt ?? row.createdAt,
    stackFound: row.stackFound !== false,
    inventoryDir: row.inventoryDir ?? null,
    backups,
    totalCount: row.totalCount ?? backups.length,
    totalBytes: row.totalBytes ?? 0,
    newestAt: row.newestAt ?? null,
    truncated: row.truncated === true,
  };
}

interface InventoryDerivation {
  requestId: RequestId | null;
  row: BackupRowView | null | undefined;
  now: number;
  connected: boolean | undefined;
  offlineRejected: boolean;
  callFailure: string | null;
  hasPrevious: boolean;
}

/** The displayed inventory view, in the order the brief fixes: call failure, idle, loading, row. */
// fallow-ignore-next-line complexity
function deriveInventory(input: InventoryDerivation): BackupInventoryView {
  if (input.callFailure !== null) return { kind: 'failed', message: input.callFailure };
  if (input.requestId === null) return idleView(input.connected, input.offlineRejected);
  if (input.row === undefined) return { kind: 'asking', hasPrevious: input.hasPrevious };
  if (input.row === null) {
    return {
      kind: 'failed',
      message: 'The backup list is no longer available. Check backups again.',
    };
  }
  if (input.row.status === 'requested') {
    return input.row.expiresAt <= input.now
      ? { kind: 'timedOut' }
      : { kind: 'asking', hasPrevious: input.hasPrevious };
  }
  if (input.row.status === 'completed') return inventoryReadyView(input.row, input.requestId);
  if (input.row.status === 'failed')
    return { kind: 'failed', message: rowFailureMessage(input.row) };
  return { kind: 'failed', message: READ_FALLBACK_COPY };
}

/** A download row's filename, or null when the row is not a usable download. */
function downloadFilename(row: BackupRowView | null | undefined): string | null {
  if (!row || row.kind !== 'download') return null;
  return row.filename ?? null;
}

function failedDownloadView(
  row: BackupRowView,
  filename: string,
  requestId: RequestId | null
): FailureView {
  const code = row.errorCode ?? UNKNOWN_CODE;
  const copy = backupFailureCopy(code);
  const message = code === UNKNOWN_CODE && row.errorMessage ? row.errorMessage : copy.message;
  return {
    kind: 'failed',
    requestId,
    filename,
    code,
    message,
    retryable: copy.retryable,
  };
}

/** Map one request row to the download view; `now` flips ready→expired without waiting for the cron. */
// fallow-ignore-next-line complexity
function downloadRowView(
  row: BackupRowView | null | undefined,
  now: number,
  receivedBytes: number
): BackupDownloadView {
  const filename = downloadFilename(row);
  if (!row || filename === null) return { kind: 'none' };
  const requestId = row._id;

  switch (row.status) {
    case 'requested':
      return { kind: 'requested', requestId, filename };
    case 'preparing':
      return {
        kind: 'preparing',
        requestId,
        filename,
        sizeBytes: row.sizeBytes ?? null,
        preparingAt: row.preparingAt ?? row.createdAt,
      };
    case 'ready':
      return row.expiresAt <= now
        ? { kind: 'expired', requestId, filename }
        : {
            kind: 'ready',
            requestId,
            filename,
            sizeBytes: row.sizeBytes ?? 0,
            expiresAt: row.expiresAt,
          };
    case 'downloading':
      return row.expiresAt <= now
        ? { kind: 'expired', requestId, filename }
        : {
            kind: 'downloading',
            requestId,
            filename,
            sizeBytes: row.sizeBytes ?? 0,
            receivedBytes,
          };
    case 'downloaded':
      return { kind: 'done', requestId, filename, sizeBytes: row.sizeBytes ?? 0 };
    case 'cancelled':
      return { kind: 'cancelled', requestId, filename };
    case 'expired':
      return { kind: 'expired', requestId, filename };
    case 'failed':
      return failedDownloadView(row, filename, requestId);
    default:
      return { kind: 'none' };
  }
}

/** Confirms the received copy up to three times; false means the cloud copy may still exist. */
async function confirmWithRetries(
  writeConfirmation: (args: {
    requestId: RequestId;
    receivedBytes: number;
  }) => Promise<{ ok: boolean }>,
  requestId: RequestId,
  receivedBytes: number
): Promise<boolean> {
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    try {
      const result = await writeConfirmation({ requestId, receivedBytes });
      if (result.ok) return true;
    } catch {
      // Retry; the temporary copy expires on its own if every attempt fails.
    }
  }
  return false;
}

/** The request id a cancel should target, or null when the view has no server row. */
function cancellableRequestId(view: BackupDownloadView): RequestId | null {
  if (view.kind === 'none' || view.kind === 'failed') return null;
  return view.requestId as RequestId;
}

// fallow-ignore-next-line complexity
export function useMachineBackups(
  machineId: string,
  gate: BackupGate = {}
): UseMachineBackupsResult {
  const [inventoryRequestId, setInventoryRequestId] = useState<RequestId | null>(null);
  const [trackedDownloadId, setTrackedDownloadId] = useState<RequestId | null>(null);
  const [callFailure, setCallFailure] = useState<string | null>(null);
  const [offlineRejected, setOfflineRejected] = useState(false);
  const [failure, setFailure] = useState<FailureView | null>(null);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [saving, setSaving] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const savingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const now = useNow(TICK_MS);

  const inventoryRow = useSessionQuery(
    api.machineBackups.getRequest,
    inventoryRequestId === null ? 'skip' : { requestId: inventoryRequestId }
  );
  const trackedRow = useSessionQuery(
    api.machineBackups.getRequest,
    trackedDownloadId === null ? 'skip' : { requestId: trackedDownloadId }
  );
  const activeRow = useSessionQuery(api.machineBackups.getActiveDownload, { machineId });

  const createInventoryRequest = useSessionMutation(api.machineBackups.createInventoryRequest);
  const createDownloadRequest = useSessionMutation(api.machineBackups.createDownloadRequest);
  const createDownloadAccess = useSessionMutation(api.machineBackups.createDownloadAccess);
  const writeDownloadConfirmation = useSessionMutation(
    api.machineBackups.writeDownloadConfirmation
  );
  const cancelRequest = useSessionMutation(api.machineBackups.cancelRequest);

  const inventory = deriveInventory({
    requestId: inventoryRequestId,
    row: inventoryRow,
    now,
    connected: gate.connected,
    offlineRejected,
    callFailure,
    hasPrevious,
  });

  const download: BackupDownloadView =
    failure ?? downloadRowView(trackedRow ?? activeRow, now, receivedBytes);
  const activeFilename = downloadFilename(activeRow);

  // Unmount (collapse or navigation) aborts the stream; the row stays `downloading` until it is
  // saved again, cancelled, or expires.
  useEffect(() => () => abortRef.current?.abort(), []);

  const refresh = useCallback(async () => {
    if (inventory.kind === 'ready') setHasPrevious(true);
    setCallFailure(null);
    try {
      const { requestId } = await createInventoryRequest({ machineId });
      setOfflineRejected(false);
      setInventoryRequestId(requestId);
    } catch (error) {
      if (getConvexErrorCode(error) === MACHINE_OFFLINE_CODE) setOfflineRejected(true);
      else setCallFailure(getMachineErrorCopy(error, REQUEST_FALLBACK_COPY));
    }
  }, [createInventoryRequest, inventory.kind, machineId]);

  const requestDownload = useCallback(
    async (filename: string) => {
      setFailure(null);
      setReceivedBytes(0);
      setTrackedDownloadId(null);
      try {
        const { requestId } = await createDownloadRequest({ machineId, filename });
        setTrackedDownloadId(requestId);
      } catch (error) {
        const code = getConvexErrorCode(error) ?? 'UNKNOWN';
        setFailure({
          kind: 'failed',
          requestId: null,
          filename,
          code,
          message: getMachineErrorCopy(error, REQUEST_DOWNLOAD_FALLBACK_COPY),
          retryable: code !== 'BACKUP_TOO_LARGE',
        });
      }
    },
    [createDownloadRequest, machineId]
  );

  // fallow-ignore-next-line complexity
  const save = useCallback(async () => {
    const savable = download.kind === 'ready' || download.kind === 'downloading';
    if (!savable || savingRef.current) return;
    const { requestId, filename } = download;
    const serverRequestId = requestId as RequestId;
    savingRef.current = true;
    setSaving(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const access = await createDownloadAccess({ requestId: serverRequestId });
      if (!access.ok) {
        if (access.reason === 'not_found') {
          setFailure({
            kind: 'failed',
            requestId,
            filename,
            code: 'BACKUP_NOT_FOUND',
            ...backupFailureCopy('BACKUP_NOT_FOUND'),
          });
        } else if (access.reason === 'not_ready') {
          setFailure({
            kind: 'failed',
            requestId,
            filename,
            code: 'not_ready',
            message: NOT_READY_COPY,
            retryable: true,
          });
        }
        return;
      }

      const streamed = await downloadBackupStream({
        url: access.url,
        expectedBytes: access.sizeBytes,
        signal: controller.signal,
        onProgress: setReceivedBytes,
      });
      if (!streamed.ok) {
        if (streamed.reason === 'aborted' && controller.signal.aborted) return;
        const code =
          streamed.reason === 'size_mismatch' ? 'download_size_mismatch' : streamed.reason;
        setFailure({
          kind: 'failed',
          requestId,
          filename,
          code,
          ...backupFailureCopy(code),
        });
        return;
      }

      downloadBlobFile(access.filename, streamed.blob);
      const confirmed = await confirmWithRetries(
        writeDownloadConfirmation,
        serverRequestId,
        access.sizeBytes
      );
      if (!confirmed) {
        setFailure({
          kind: 'failed',
          requestId,
          filename,
          code: 'confirm_failed',
          message: CONFIRM_FAILED_COPY,
          retryable: false,
        });
      }
    } catch {
      setFailure({
        kind: 'failed',
        requestId,
        filename,
        code: 'network',
        ...backupFailureCopy('network'),
      });
    } finally {
      savingRef.current = false;
      abortRef.current = null;
      setSaving(false);
    }
  }, [createDownloadAccess, download, writeDownloadConfirmation]);

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    const requestId = cancellableRequestId(download);
    if (requestId !== null) await cancelRequest({ requestId }).catch(() => undefined);
  }, [cancelRequest, download]);

  return {
    inventory,
    download,
    activeFilename,
    saving,
    refresh,
    requestDownload,
    save,
    cancel,
  };
}
