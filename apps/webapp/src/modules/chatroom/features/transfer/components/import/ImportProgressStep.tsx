'use client';

import { AlertTriangle, Check, Loader2, Minus, Square } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import type { ImportViewState } from '../../hooks/useTransferImport';
import { closeUnlessModified } from '../../lib/closeUnlessModified';
import { countsFor, deriveImportRows, type ImportRowStatus } from '../../lib/importRows';
import {
  chatroomLabel,
  IMPORT_KEEP_OPEN_COPY,
  IMPORT_ROW_IMPORTED,
  IMPORT_ROW_NOT_STARTED,
  IMPORT_ROW_ROLLING_BACK,
  IMPORT_ROW_WAITING,
  IMPORT_ROLLING_BACK_COPY,
  IMPORT_STOP_CONFIRM_TITLE,
  importFailedStatusCopy,
  importingChunkCopy,
} from '../../lib/transferCopy';

import { Button } from '@/components/ui/button';
import { DialogFooter, DialogScrollBody } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  chatroomIndustrialButtonDestructiveClassName,
  chatroomIndustrialDialogFooterClassName,
} from '@/modules/chatroom/components/shared/industrialDialogStyles';

type ImportingState = Extract<ImportViewState, { kind: 'importing' }>;

interface ImportProgressStepProps {
  state: ImportingState;
  confirmingStop: boolean;
  onRequestStop(): void;
  onKeep(): void;
  onConfirmStop(): void;
  /** A result link was clicked on a plain click. */
  onClose(): void;
}

/** The progress step, running or cancelling, with the inline stop confirmation. */
// fallow-ignore-next-line complexity
export function ImportProgressStep({
  state,
  confirmingStop,
  onRequestStop,
  onKeep,
  onConfirmStop,
  onClose,
}: ImportProgressStepProps) {
  const rows = deriveImportRows(
    state.listing,
    state.keys,
    state.current,
    state.results,
    state.cancelling
  );
  const counts = countsFor(rows);
  const done = counts.imported + counts.failed + counts.skipped;
  const total = state.keys.length;
  const stopRef = useRef<HTMLButtonElement>(null);
  useReturnFocusToStop(stopRef, confirmingStop);

  return (
    <>
      <DialogScrollBody className="min-h-0 flex-1 space-y-3">
        {state.cancelling ? (
          <p role="status" className="flex items-center gap-2 text-xs text-chatroom-text-primary">
            <Loader2 className="animate-spin" size={14} aria-hidden />
            {IMPORT_ROLLING_BACK_COPY}
          </p>
        ) : (
          <p role="status" className="text-xs text-chatroom-text-primary">
            Importing {Math.min(done + 1, total)} of {total} · {IMPORT_KEEP_OPEN_COPY}
          </p>
        )}
        <Progress
          value={done}
          max={total}
          aria-label="Import progress"
          className={IMPORT_PROGRESS_CLASS}
        />
        <ul
          data-testid="import-progress-list"
          className="divide-y divide-chatroom-border border border-chatroom-border"
        >
          {rows.map((row) => (
            <li
              key={row.entry.key}
              data-testid="import-progress-row"
              data-status={row.status.kind}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs"
            >
              <StatusIcon status={row.status} />
              <span className="min-w-0 truncate font-bold uppercase tracking-wide">
                {chatroomLabel(row.entry.name)}
              </span>
              <span className="ml-auto text-[10px] text-chatroom-text-muted sm:text-right">
                {statusText(row.status)}
              </span>
              {row.status.kind === 'imported' && (
                <Link
                  href={`/app/chatroom?id=${row.status.chatroomId}`}
                  onClick={(event) => closeUnlessModified(event, onClose)}
                  className="text-[10px] font-bold uppercase text-chatroom-accent hover:underline"
                >
                  Open →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </DialogScrollBody>
      <DialogFooter className={chatroomIndustrialDialogFooterClassName}>
        {confirmingStop ? (
          <StopConfirm
            imported={counts.imported}
            remaining={counts.queued}
            onKeep={onKeep}
            onConfirm={onConfirmStop}
          />
        ) : (
          <Button
            ref={stopRef}
            variant="secondary"
            disabled={state.cancelling}
            data-testid="import-stop"
            onClick={onRequestStop}
          >
            {state.cancelling && <Loader2 className="animate-spin" size={14} aria-hidden />}
            Stop import
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * The shared Progress renders its own track, so the industrial bar is applied
 * through call-site class overrides rather than a second, duplicated track.
 */
const IMPORT_PROGRESS_CLASS =
  'gap-0 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:w-full [&_[data-slot=progress-track]]:rounded-none [&_[data-slot=progress-track]]:bg-chatroom-bg-tertiary [&_[data-slot=progress-indicator]]:h-full [&_[data-slot=progress-indicator]]:rounded-none [&_[data-slot=progress-indicator]]:bg-chatroom-accent [&_[data-slot=progress-indicator]]:transition-all';

// fallow-ignore-next-line complexity
function StatusIcon({ status }: { status: ImportRowStatus }) {
  switch (status.kind) {
    case 'queued':
      return <Square size={14} className="shrink-0 text-chatroom-text-muted" aria-hidden />;
    case 'running':
      return <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden />;
    case 'imported':
      return <Check size={14} className="shrink-0 text-chatroom-status-success" aria-hidden />;
    case 'failed':
      return (
        <AlertTriangle size={14} className="shrink-0 text-chatroom-status-error" aria-hidden />
      );
    case 'skipped':
      return <Minus size={14} className="shrink-0" aria-hidden />;
  }
}

// fallow-ignore-next-line complexity
function statusText(status: ImportRowStatus): string {
  switch (status.kind) {
    case 'queued':
      return IMPORT_ROW_WAITING;
    case 'running':
      return status.rollingBack
        ? IMPORT_ROW_ROLLING_BACK
        : importingChunkCopy(status.chunksDone, status.chunksTotal);
    case 'imported':
      return IMPORT_ROW_IMPORTED;
    case 'failed':
      return importFailedStatusCopy(status.code, status.message);
    case 'skipped':
      return IMPORT_ROW_NOT_STARTED;
  }
}

/** Focus starts on "Keep importing" and returns to the Stop button afterwards. */
function useReturnFocusToStop(
  stopRef: { current: HTMLButtonElement | null },
  confirmingStop: boolean
): void {
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirmingStop) stopRef.current?.focus();
    wasConfirming.current = confirmingStop;
  }, [confirmingStop, stopRef]);
}

/** Focus starts on "Keep importing" and returns to the Stop button afterwards. */
function StopConfirm({
  imported,
  remaining,
  onKeep,
  onConfirm,
}: {
  imported: number;
  remaining: number;
  onKeep(): void;
  onConfirm(): void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-labelledby="stop-title"
      className="w-full space-y-3 border border-chatroom-status-warning/40 bg-chatroom-status-warning/10 p-3 text-xs"
    >
      <p id="stop-title" className="font-bold">
        {IMPORT_STOP_CONFIRM_TITLE}
      </p>
      <p>
        The chatroom being imported now is removed.
        {imported > 0 && ` ${imported} already imported stay in your account.`}
        {remaining > 0 && ` ${remaining} will not be started.`}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button ref={keepRef} variant="secondary" onClick={onKeep} data-testid="import-stop-keep">
          Keep importing
        </Button>
        <Button
          className={chatroomIndustrialButtonDestructiveClassName}
          onClick={onConfirm}
          data-testid="import-stop-confirm"
        >
          Stop import
        </Button>
      </div>
    </div>
  );
}
