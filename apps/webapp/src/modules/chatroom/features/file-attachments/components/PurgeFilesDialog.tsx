'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery, type PaginatedQueryReference } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';

import { getFileAttachmentErrorMessage } from '../lib/fileAttachmentErrors';
import { formatFileSize } from '../lib/formatFileSize';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PREVIEW_PAGE_SIZE = 25;
const PREVIEW_CAP = 250;
const CALCULATING_STATUSES = new Set(['LoadingFirstPage', 'LoadingMore']);

/** Same read model as `FileManagerList`; only the size and id are needed here. */
interface FileListItem {
  _id: Id<'chatroom_fileAttachments'>;
  sizeBytes: number;
}

export interface PurgeFilesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatroomId?: Id<'chatroom_rooms'>;
  /** 0 means any size. */
  minSizeBytes: number;
  onPurged: (result: { deleted: number; continuing: boolean }) => void;
}

interface PurgePreview {
  calculating: boolean;
  count: number;
  bytes: number;
  capped: boolean;
}

function isCalculating(status: string): boolean {
  return CALCULATING_STATUSES.has(status);
}

function lastQualifies(results: FileListItem[], minSizeBytes: number): boolean {
  const last = results.at(-1);
  return last !== undefined && last.sizeBytes >= minSizeBytes;
}

function needsMorePages(
  open: boolean,
  status: string,
  results: FileListItem[],
  minSizeBytes: number
): boolean {
  if (!open || status !== 'CanLoadMore' || results.length >= PREVIEW_CAP) return false;
  return lastQualifies(results, minSizeBytes);
}

function isCapped(results: FileListItem[], status: string, minSizeBytes: number): boolean {
  if (results.length < PREVIEW_CAP || status === 'Exhausted') return false;
  return lastQualifies(results, minSizeBytes);
}

function previewArgs(
  open: boolean,
  sessionId: string | undefined,
  chatroomId: Id<'chatroom_rooms'> | undefined
) {
  if (!open || !sessionId) return 'skip' as const;
  return {
    sessionId,
    sort: 'largest' as const,
    ...(chatroomId ? { chatroomId } : {}),
  };
}

function qualifyingFiles(results: FileListItem[], minSizeBytes: number): FileListItem[] {
  return results.filter((file) => file.sizeBytes >= minSizeBytes);
}

/**
 * Counts the files the purge will delete. Pages are loaded while the last file
 * still qualifies, stopping at 250 so the dialog stays responsive.
 */
function usePurgePreview(
  open: boolean,
  chatroomId: Id<'chatroom_rooms'> | undefined,
  minSizeBytes: number
): PurgePreview {
  const [sessionId] = useSessionId();
  const paginated = usePaginatedQuery(
    api.fileAttachments.listFiles as PaginatedQueryReference,
    previewArgs(open, sessionId, chatroomId),
    { initialNumItems: PREVIEW_PAGE_SIZE }
  );
  const results = paginated.results as FileListItem[];
  const { status, loadMore } = paginated;

  useEffect(() => {
    if (needsMorePages(open, status, results, minSizeBytes)) {
      loadMore(PREVIEW_PAGE_SIZE);
    }
  }, [open, status, results, loadMore, minSizeBytes]);

  const qualifying = qualifyingFiles(results, minSizeBytes);
  return {
    calculating: isCalculating(status),
    count: qualifying.length,
    bytes: qualifying.reduce((total, file) => total + file.sizeBytes, 0),
    capped: isCapped(results, status, minSizeBytes),
  };
}

function scopeCopy(chatroomScope: boolean): string {
  return chatroomScope ? 'this chatroom' : 'all your chatrooms';
}

function countLabel(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

function thresholdLabel(minSizeBytes: number): string {
  return minSizeBytes > 0 ? ` larger than ${formatFileSize(minSizeBytes)}` : '';
}

function primaryCopy(preview: PurgePreview, minSizeBytes: number, chatroomScope: boolean): string {
  if (preview.count === 0) return 'No files match this size.';
  const scope = scopeCopy(chatroomScope);
  if (preview.capped) {
    return `More than 250 files · at least ${formatFileSize(preview.bytes)} will be permanently deleted from ${scope}.`;
  }
  return `${countLabel(preview.count)} · ${formatFileSize(preview.bytes)}${thresholdLabel(minSizeBytes)} will be permanently deleted from ${scope}.`;
}

function deleteLabel(count: number): string {
  if (count === 0) return 'Delete files';
  return count === 1 ? 'Delete 1 file' : `Delete ${count} files`;
}

function actionLabel(preview: PurgePreview, purging: boolean): string {
  if (purging) return 'Deleting…';
  return preview.capped ? 'Delete files' : deleteLabel(preview.count);
}

function PurgeDescription({
  preview,
  minSizeBytes,
  chatroomScope,
  error,
}: {
  preview: PurgePreview;
  minSizeBytes: number;
  chatroomScope: boolean;
  error: string | null;
}) {
  return (
    <>
      <AlertDialogDescription>
        {preview.calculating ? (
          <span className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            Calculating…
          </span>
        ) : (
          <span className="block">{primaryCopy(preview, minSizeBytes, chatroomScope)}</span>
        )}
        <span className="mt-1 block">
          Agents&apos; handoffs will show them as &quot;File removed&quot;. This can&apos;t be
          undone.
        </span>
      </AlertDialogDescription>
      {error && <p className="text-[11px] text-chatroom-status-error">{error}</p>}
    </>
  );
}

function PurgeActions({
  preview,
  purging,
  disabled,
  onConfirm,
}: {
  preview: PurgePreview;
  purging: boolean;
  disabled: boolean;
  onConfirm: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel disabled={purging}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className="bg-chatroom-status-error text-white hover:bg-chatroom-status-error/90"
        disabled={disabled}
        onClick={onConfirm}
      >
        {actionLabel(preview, purging)}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

/**
 * Purge confirmation for one scope. The preview is counted client-side from the
 * same paginated list the manager uses; the mutation itself is server-bounded.
 */
export function PurgeFilesDialog({
  open,
  onOpenChange,
  chatroomId,
  minSizeBytes,
  onPurged,
}: PurgeFilesDialogProps) {
  const preview = usePurgePreview(open, chatroomId, minSizeBytes);
  const purgeFiles = useSessionMutation(api.fileAttachments.purgeFiles);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) setError(null);
    onOpenChange(next);
  };

  const confirm = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setPurging(true);
    setError(null);
    try {
      const result = await purgeFiles({
        chatroomId,
        minSizeBytes: minSizeBytes || undefined,
      });
      setPurging(false);
      onPurged(result);
      onOpenChange(false);
    } catch (err) {
      setError(getFileAttachmentErrorMessage(err));
      setPurging(false);
    }
  };

  const disabled = preview.calculating || preview.count === 0 || purging;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete files permanently?</AlertDialogTitle>
          <PurgeDescription
            preview={preview}
            minSizeBytes={minSizeBytes}
            chatroomScope={chatroomId !== undefined}
            error={error}
          />
        </AlertDialogHeader>
        <PurgeActions preview={preview} purging={purging} disabled={disabled} onConfirm={confirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
