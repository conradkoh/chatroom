'use client';

import { BACKUP_MAX_BYTES } from '@workspace/shared/domain/machine-backup';
import { Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { BackupDownloadStatus } from './BackupDownloadStatus';
import { BackupDownloadWarningDialog } from './BackupDownloadWarningDialog';
import { BackupRow } from './BackupRow';
import { LedgerNotice } from './LedgerNotice';
import { pluralize } from '../../transfer/lib/transferCopy';
import {
  useMachineBackups,
  type BackupDownloadView,
  type BackupInventoryView,
} from '../hooks/useMachineBackups';
import {
  BACKUP_CONNECTING_COPY,
  BACKUP_EMPTY_COPY,
  BACKUP_EMPTY_HELP,
  BACKUP_NO_STACK_COPY,
  BACKUP_OFFLINE_COPY,
  BACKUP_SECTION_INTRO,
  BACKUP_TIMED_OUT_COPY,
} from '../lib/backupCopy';
import { formatLastSeen } from '../lib/machineDisplay';

import { InlineFeedback } from '@/components/inline-feedback';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/modules/chatroom/components/CopyButton';
import { formatFileSize } from '@/modules/chatroom/features/file-attachments/lib/formatFileSize';
import { formatTimestampFull } from '@/modules/chatroom/utils/chatroomTimestamp';

const SECTION_HEADING_CLASS =
  'text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted';

type ReadyView = Extract<BackupInventoryView, { kind: 'ready' }>;
type BackupEntry = ReadyView['backups'][number];
type IdleView = Extract<BackupInventoryView, { kind: 'idle' }>;

type PendingBackup = { filename: string; sizeBytes: number | null; modifiedAt: number | null };

/** The inventory entry for a filename, or a filename-only stand-in when the list no longer has it. */
function retryBackup(filename: string, snapshot: ReadyView | null): PendingBackup {
  return (
    snapshot?.backups.find((backup) => backup.filename === filename) ?? {
      filename,
      sizeBytes: null,
      modifiedAt: null,
    }
  );
}

export interface MachineBackupsProps {
  machineId: string;
  displayName: string;
  /** undefined while connectivity is unresolved. */
  connected: boolean | undefined;
}

/** Stable key for the current download view, so a dismissed terminal block stays dismissed. */
// fallow-ignore-next-line complexity
function downloadViewKey(view: BackupDownloadView): string | null {
  switch (view.kind) {
    case 'none':
      return null;
    case 'failed':
      return `failed:${view.requestId ?? view.filename}`;
    case 'done':
    case 'cancelled':
    case 'expired':
      return `${view.kind}:${view.requestId}`;
    default:
      return `active:${view.requestId}`;
  }
}

function idleCopy(view: IdleView): string | null {
  if (view.blockedBy === 'offline') return BACKUP_OFFLINE_COPY;
  if (view.blockedBy === 'connecting') return BACKUP_CONNECTING_COPY;
  return null;
}

function IdleBody({ view, onCheck }: { view: IdleView; onCheck(): void }) {
  const copy = idleCopy(view);
  return (
    <div data-testid="backups-idle" className="mt-3 space-y-3">
      {copy && <p className="text-xs text-chatroom-text-muted">{copy}</p>}
      <Button data-testid="backups-check" disabled={!view.canAsk} onClick={onCheck}>
        Check backups
      </Button>
    </div>
  );
}

function AskingBody({ displayName }: { displayName: string }) {
  return (
    <div data-testid="backups-asking" className="mt-3 space-y-3">
      <div className="flex items-center gap-2 text-xs text-chatroom-text-primary">
        <Loader2 size={14} className="animate-spin text-chatroom-text-muted" aria-hidden />
        Asking daemon…
      </div>
      <p className="text-xs text-chatroom-text-muted">
        Waiting for {displayName} to list its backups.
      </p>
    </div>
  );
}

function RefreshButton({
  asking,
  disabled,
  label,
  onClick,
}: {
  asking: boolean;
  disabled: boolean;
  label: string;
  onClick(): void;
}) {
  return (
    <Button
      data-testid="backups-refresh"
      variant="outline"
      size="xs"
      disabled={disabled || asking}
      onClick={onClick}
    >
      {asking ? (
        <>
          <Loader2 size={12} className="animate-spin" aria-hidden />
          Asking daemon…
        </>
      ) : (
        <>
          <RefreshCw size={12} aria-hidden />
          {label}
        </>
      )}
    </Button>
  );
}

/** Timed-out or failed inventory with a retry; the previous snapshot stays below when there is one. */
function InventoryNotice({
  view,
  onRetry,
}: {
  view: Extract<BackupInventoryView, { kind: 'timedOut' | 'failed' }>;
  onRetry(): void;
}) {
  return (
    <div data-testid="backups-notice" className="mt-3 space-y-3">
      {view.kind === 'timedOut' ? (
        <LedgerNotice testId="backups-timed-out">{BACKUP_TIMED_OUT_COPY}</LedgerNotice>
      ) : (
        <InlineFeedback
          feedback={{
            id: 1,
            tone: 'error',
            message: `Could not read backups: ${view.message}`,
          }}
          data-testid="backups-failed"
        />
      )}
      <Button data-testid="backups-retry" variant="outline" size="xs" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function DirectoryRow({ directory }: { directory: string }) {
  return (
    <div data-testid="backups-directory" className="flex items-center gap-2">
      <code className="min-w-0 break-all border border-chatroom-border bg-chatroom-bg-tertiary px-2 py-1 font-mono text-[10px]">
        {directory}
      </code>
      <CopyButton text={directory} label="Copy" copiedLabel="Copied!" variant="compact" />
    </div>
  );
}

function SummaryLine({ view }: { view: ReadyView }) {
  const newest = view.newestAt === null ? 'unknown' : formatLastSeen(view.newestAt, Date.now());
  return (
    <p data-testid="backups-summary" className="font-mono text-[10px] text-chatroom-text-muted">
      {pluralize(view.totalCount, 'backup')} · newest {newest} · {formatFileSize(view.totalBytes)}{' '}
      total
    </p>
  );
}

function EmptyBody({
  view,
  connected,
  asking,
  onRefresh,
  status,
}: {
  view: ReadyView;
  connected: boolean | undefined;
  asking: boolean;
  onRefresh(): void;
  status: ReactNode;
}) {
  return (
    <div data-testid="backups-empty" className="mt-3 space-y-3">
      <div>
        <p className="text-xs font-bold text-chatroom-text-primary">{BACKUP_EMPTY_COPY}</p>
        <p className="text-xs text-chatroom-text-muted">{BACKUP_EMPTY_HELP}</p>
      </div>
      <RefreshButton
        asking={asking}
        disabled={connected !== true}
        label="Refresh"
        onClick={onRefresh}
      />
      {view.inventoryDir !== null && <DirectoryRow directory={view.inventoryDir} />}
      {status}
    </div>
  );
}

/** Offline wins over busy so a stale snapshot explains why nothing can be downloaded. */
function rowDisabledTitle(connected: boolean | undefined, busy: boolean): string | undefined {
  if (connected !== true) return BACKUP_OFFLINE_COPY;
  return busy ? 'Another backup is being prepared on this machine.' : undefined;
}

function SnapshotList({
  view,
  connected,
  asking,
  activeFilename,
  onRefresh,
  onDownload,
  status,
}: {
  view: ReadyView;
  connected: boolean | undefined;
  asking: boolean;
  activeFilename: string | null;
  onRefresh(): void;
  onDownload(backup: BackupEntry): void;
  status: ReactNode;
}) {
  const busy = activeFilename !== null;
  return (
    <div data-testid="backups-ready" className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SummaryLine view={view} />
        <RefreshButton
          asking={asking}
          disabled={connected !== true}
          label="Refresh"
          onClick={onRefresh}
        />
      </div>
      <p data-testid="backups-as-of" className="text-[10px] text-chatroom-text-muted">
        As of {formatTimestampFull(view.asOf)}
      </p>
      {view.inventoryDir !== null && <DirectoryRow directory={view.inventoryDir} />}
      {status}
      <ul data-testid="backups-list" className="border-t border-chatroom-border">
        {view.backups.map((backup) => {
          const tooLarge = backup.sizeBytes > BACKUP_MAX_BYTES;
          return (
            <BackupRow
              key={backup.filename}
              backup={backup}
              tooLarge={tooLarge}
              disabled={connected !== true || busy || tooLarge}
              disabledTitle={rowDisabledTitle(connected, busy)}
              activeHere={activeFilename === backup.filename}
              onDownload={() => onDownload(backup)}
            />
          );
        })}
      </ul>
      {view.truncated && (
        <p data-testid="backups-truncated" className="text-[10px] text-chatroom-text-muted">
          Showing the newest {view.backups.length} of {view.totalCount} backups.
        </p>
      )}
    </div>
  );
}

function NoStackBody({
  connected,
  asking,
  onRefresh,
  status,
}: {
  connected: boolean | undefined;
  asking: boolean;
  onRefresh(): void;
  status: ReactNode;
}) {
  return (
    <div data-testid="backups-no-stack" className="mt-3 space-y-3">
      <p className="text-xs text-chatroom-text-muted">{BACKUP_NO_STACK_COPY}</p>
      <RefreshButton
        asking={asking}
        disabled={connected !== true}
        label="Check again"
        onClick={onRefresh}
      />
      {status}
    </div>
  );
}

function SnapshotBody({
  view,
  connected,
  asking,
  activeFilename,
  onRefresh,
  onDownload,
  status,
}: {
  view: ReadyView;
  connected: boolean | undefined;
  asking: boolean;
  activeFilename: string | null;
  onRefresh(): void;
  onDownload(backup: BackupEntry): void;
  status: ReactNode;
}) {
  if (!view.stackFound) {
    return (
      <NoStackBody connected={connected} asking={asking} onRefresh={onRefresh} status={status} />
    );
  }
  if (view.backups.length === 0) {
    return (
      <EmptyBody
        view={view}
        connected={connected}
        asking={asking}
        onRefresh={onRefresh}
        status={status}
      />
    );
  }
  return (
    <SnapshotList
      view={view}
      connected={connected}
      asking={asking}
      activeFilename={activeFilename}
      onRefresh={onRefresh}
      onDownload={onDownload}
      status={status}
    />
  );
}

/**
 * Backups section for one expanded machine card.
 *
 * Inventory is on demand: nothing is requested until Check backups is pressed, and the section
 * mounts only inside the expanded card. A download is a warned, ephemeral copy: Requested →
 * Preparing → Ready → Downloading → Done, with the cloud copy deleted on receipt.
 */
// fallow-ignore-next-line complexity
export function MachineBackups({ machineId, displayName, connected }: MachineBackupsProps) {
  const backups = useMachineBackups(machineId, { connected });
  const { inventory, download, activeFilename, saving, refresh, requestDownload, save, cancel } =
    backups;
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const lastReady = useRef<ReadyView | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inventory.kind === 'ready') lastReady.current = inventory;
  }, [inventory]);

  const requestId = download.kind === 'none' ? null : download.requestId;
  useEffect(() => {
    if (requestId !== null) statusRef.current?.focus();
  }, [requestId]);

  const snapshot = inventory.kind === 'ready' ? inventory : lastReady.current;
  const asking = inventory.kind === 'asking';

  const viewKey = downloadViewKey(download);

  // Starting (or retrying) a download must reveal a terminal block the user dismissed earlier;
  // otherwise a repeat failure would stay hidden behind the dismissed key.
  const startDownload = (filename: string) => {
    setDismissedKey(null);
    void requestDownload(filename);
  };

  /** Retry goes through the same credentials warning as a first request. */
  const retryDownload = (filename: string) => {
    setDismissedKey(null);
    setPending(retryBackup(filename, snapshot));
  };

  const status =
    viewKey !== null && viewKey !== dismissedKey ? (
      <BackupDownloadStatus
        view={download}
        displayName={displayName}
        saving={saving}
        onSave={() => void save()}
        onCancel={() => void cancel()}
        onRetry={() => {
          if (download.kind === 'failed' || download.kind === 'expired') {
            retryDownload(download.filename);
          }
        }}
        onDismiss={() => setDismissedKey(viewKey)}
        statusRef={statusRef}
      />
    ) : null;

  return (
    <div data-testid="machine-backups">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_HEADING_CLASS}>Backups</h3>
        {snapshot !== null && (
          <span
            className="font-mono text-[10px] tabular-nums text-chatroom-text-muted"
            data-testid="backups-count"
          >
            {pluralize(snapshot.totalCount, 'backup')}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-chatroom-text-muted">{BACKUP_SECTION_INTRO}</p>

      {inventory.kind === 'idle' && <IdleBody view={inventory} onCheck={() => void refresh()} />}
      {inventory.kind === 'asking' && !inventory.hasPrevious && (
        <AskingBody displayName={displayName} />
      )}
      {(inventory.kind === 'timedOut' || inventory.kind === 'failed') && (
        <InventoryNotice view={inventory} onRetry={() => void refresh()} />
      )}
      {snapshot === null && status}
      {snapshot !== null && (
        <SnapshotBody
          view={snapshot}
          connected={connected}
          asking={asking}
          activeFilename={activeFilename}
          onRefresh={() => void refresh()}
          onDownload={setPending}
          status={status}
        />
      )}

      {pending !== null && (
        <BackupDownloadWarningDialog
          filename={pending.filename}
          sizeBytes={pending.sizeBytes}
          modifiedAt={pending.modifiedAt}
          machineName={displayName}
          onConfirm={() => {
            const target = pending;
            setPending(null);
            startDownload(target.filename);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
