'use client';

import { Check, Loader2 } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import type { BackupDownloadView } from '../hooks/useMachineBackups';
import { elapsedLabel, minutesLeftLabel } from '../lib/backupCopy';
import { useNow } from '../lib/useNow';

import { InlineFeedback, type Feedback } from '@/components/inline-feedback';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatFileSize } from '@/modules/chatroom/features/file-attachments/lib/formatFileSize';

/** The same descendant overrides slice 2 uses so the shared Progress stays untouched. */
const BACKUP_PROGRESS_CLASS =
  'gap-0 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:w-full [&_[data-slot=progress-track]]:rounded-none [&_[data-slot=progress-track]]:bg-chatroom-bg-tertiary [&_[data-slot=progress-indicator]]:h-full [&_[data-slot=progress-indicator]]:rounded-none [&_[data-slot=progress-indicator]]:bg-chatroom-accent [&_[data-slot=progress-indicator]]:transition-all';

const FEEDBACK_ID = 1;

const READY_DETAIL =
  'A temporary copy is ready. It is deleted after you save it, or when it expires.';
const CANCEL_HELP = 'Stops the download and deletes the temporary copy.';
const DISCARD_HELP = (displayName: string) =>
  `Discard removes only the temporary copy. The backup on ${displayName} is not touched.`;

export interface BackupDownloadStatusProps {
  view: BackupDownloadView;
  displayName: string;
  saving: boolean;
  onSave(): void;
  onCancel(): void;
  onRetry(): void;
  onDismiss(): void;
  statusRef: RefObject<HTMLDivElement | null>;
}

interface ActiveCopy {
  icon: ReactNode;
  title: string;
  counter: string;
}

// fallow-ignore-next-line complexity
function activeCopy(
  view: Extract<BackupDownloadView, { kind: 'requested' | 'preparing' | 'ready' | 'downloading' }>,
  displayName: string,
  fastNow: number,
  slowNow: number
): ActiveCopy {
  const spinner = (
    <Loader2 size={14} className="animate-spin text-chatroom-text-muted" aria-hidden />
  );
  switch (view.kind) {
    case 'requested':
      return {
        icon: spinner,
        title: 'Requested · waiting for the daemon to pick it up',
        counter: '',
      };
    case 'preparing':
      return {
        icon: spinner,
        title: `Preparing on ${displayName}`,
        counter: elapsedLabel(fastNow - view.preparingAt),
      };
    case 'ready':
      return {
        icon: <Check size={14} className="text-chatroom-status-success" aria-hidden />,
        title: 'Ready to save',
        counter: `expires in ${minutesLeftLabel(view.expiresAt, slowNow)}`,
      };
    case 'downloading':
      return {
        icon: spinner,
        title: `Downloading ${view.filename}`,
        counter: `${formatFileSize(view.receivedBytes)} of ${formatFileSize(view.sizeBytes)}`,
      };
  }
}

function preparingDetail(sizeBytes: number | null): string {
  return sizeBytes === null
    ? 'The daemon is uploading a temporary copy.'
    : `The daemon is uploading a temporary copy (${formatFileSize(sizeBytes)}).`;
}

function activeActions(
  view: Extract<BackupDownloadView, { kind: 'requested' | 'preparing' | 'ready' | 'downloading' }>,
  displayName: string,
  saving: boolean,
  handlers: { onSave(): void; onCancel(): void }
): ReactNode {
  if (view.kind === 'ready') {
    return (
      <>
        <Button size="sm" disabled={saving} onClick={handlers.onSave}>
          {saving ? 'Saving…' : 'Save file'}
        </Button>
        <Button size="xs" variant="outline" onClick={handlers.onCancel}>
          Discard copy
        </Button>
        <p className="basis-full text-[10px] text-chatroom-text-muted">
          {DISCARD_HELP(displayName)}
        </p>
      </>
    );
  }
  const label = view.kind === 'downloading' ? 'Cancel download' : 'Cancel request';
  return (
    <>
      <Button size="xs" variant="outline" onClick={handlers.onCancel}>
        {label}
      </Button>
      <p className="basis-full text-[10px] text-chatroom-text-muted">{CANCEL_HELP}</p>
    </>
  );
}

// fallow-ignore-next-line complexity
function ActiveStatus({
  view,
  displayName,
  saving,
  onSave,
  onCancel,
  statusRef,
}: {
  view: Extract<BackupDownloadView, { kind: 'requested' | 'preparing' | 'ready' | 'downloading' }>;
  displayName: string;
  saving: boolean;
  onSave(): void;
  onCancel(): void;
  statusRef: RefObject<HTMLDivElement | null>;
}) {
  // The elapsed counter ticks every second only while preparing; the expiry counter every 30 s
  // only while ready. `useNow(0)` installs no timer, so the other states do not re-render.
  const fastNow = useNow(view.kind === 'preparing' ? 1000 : 0);
  const slowNow = useNow(view.kind === 'ready' ? 30_000 : 0);
  const copy = activeCopy(view, displayName, fastNow, slowNow);
  const detail =
    view.kind === 'preparing'
      ? preparingDetail(view.sizeBytes)
      : view.kind === 'ready'
        ? READY_DETAIL
        : null;

  return (
    <div
      role="status"
      aria-live="polite"
      ref={statusRef}
      tabIndex={-1}
      data-testid="backup-download-status"
      data-state={view.kind}
      className="mt-3 space-y-2 border border-chatroom-border bg-chatroom-bg-tertiary p-3 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        {copy.icon}
        <p className="min-w-0 font-bold">{copy.title}</p>
        <span
          aria-live="off"
          className="ml-auto font-mono text-[10px] tabular-nums text-chatroom-text-muted"
        >
          {copy.counter}
        </span>
      </div>
      {detail && <p className="text-chatroom-text-muted">{detail}</p>}
      {view.kind === 'downloading' && (
        <Progress
          value={view.receivedBytes}
          max={view.sizeBytes}
          aria-label="Download progress"
          className={BACKUP_PROGRESS_CLASS}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {activeActions(view, displayName, saving, { onSave, onCancel })}
      </div>
    </div>
  );
}

// fallow-ignore-next-line complexity
function terminalFeedback(
  view: Extract<BackupDownloadView, { kind: 'done' | 'cancelled' | 'expired' | 'failed' }>,
  displayName: string
): Feedback {
  switch (view.kind) {
    case 'done':
      return {
        id: FEEDBACK_ID,
        tone: 'success',
        message: `Saved ${view.filename} (${formatFileSize(view.sizeBytes)}). The temporary copy was deleted. The backup on ${displayName} is unchanged.`,
      };
    case 'cancelled':
      return {
        id: FEEDBACK_ID,
        tone: 'info',
        message: `Cancelled. The temporary copy was deleted. The backup on ${displayName} is unchanged.`,
      };
    case 'expired':
      return {
        id: FEEDBACK_ID,
        tone: 'warning',
        message: 'This download expired. The temporary copy was deleted after 1 hour.',
      };
    case 'failed':
      return { id: FEEDBACK_ID, tone: 'error', title: 'Download failed', message: view.message };
  }
}

// fallow-ignore-next-line complexity
function TerminalActions({
  view,
  onRetry,
  onDismiss,
}: {
  view: Extract<BackupDownloadView, { kind: 'done' | 'cancelled' | 'expired' | 'failed' }>;
  onRetry(): void;
  onDismiss(): void;
}) {
  const showRetry = view.kind === 'expired' || (view.kind === 'failed' && view.retryable);
  return (
    <div className="flex flex-wrap gap-2">
      {showRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {view.kind === 'expired' ? 'Request again' : 'Try again'}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

function TerminalStatus({
  view,
  displayName,
  onRetry,
  onDismiss,
}: {
  view: Extract<BackupDownloadView, { kind: 'done' | 'cancelled' | 'expired' | 'failed' }>;
  displayName: string;
  onRetry(): void;
  onDismiss(): void;
}) {
  return (
    <section data-testid="backup-download-status" data-state={view.kind} className="mt-3 space-y-2">
      <InlineFeedback
        feedback={terminalFeedback(view, displayName)}
        data-testid="backup-download-feedback"
      />
      <TerminalActions view={view} onRetry={onRetry} onDismiss={onDismiss} />
    </section>
  );
}

/** The download status block: one live region for active work, one InlineFeedback when terminal. */
// fallow-ignore-next-line complexity
export function BackupDownloadStatus({
  view,
  displayName,
  saving,
  onSave,
  onCancel,
  onRetry,
  onDismiss,
  statusRef,
}: BackupDownloadStatusProps) {
  if (view.kind === 'none') return null;
  if (
    view.kind === 'done' ||
    view.kind === 'cancelled' ||
    view.kind === 'expired' ||
    view.kind === 'failed'
  ) {
    return (
      <TerminalStatus
        view={view}
        displayName={displayName}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />
    );
  }
  return (
    <ActiveStatus
      view={view}
      displayName={displayName}
      saving={saving}
      onSave={onSave}
      onCancel={onCancel}
      statusRef={statusRef}
    />
  );
}
