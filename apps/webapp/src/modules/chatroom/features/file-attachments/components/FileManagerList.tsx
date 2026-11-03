'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getFilePreviewKind } from '@workspace/shared/domain/file-attachment';
import { usePaginatedQuery, type PaginatedQueryReference } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import {
  AlertTriangle,
  Download,
  Eye,
  ExternalLink,
  Loader2,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { FileAttachmentRow, FileKindIcon, type FileRowKind } from './FileAttachmentRow';
import { FilePreviewDialog } from './FilePreviewDialog';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { useTwoTapConfirm } from '../../../hooks/useTwoTapConfirm';
import { useAttachmentDownload } from '../hooks/useAttachmentDownload';
import { useFileAttachmentUrls, type FileUrlState } from '../hooks/useFileAttachmentUrls';
import { getFileAttachmentErrorMessage } from '../lib/fileAttachmentErrors';
import { fileExtensionLabel, formatFileSize } from '../lib/formatFileSize';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 25;
const ARMED_DELETE = { variant: 'destructive', size: 'xs' } as const;
const IDLE_DELETE = { variant: 'ghost', size: 'icon-xs' } as const;

/** Read model returned by `fileAttachments.listFiles` (`fileListItemValidator`). */
interface FileListItem {
  _id: Id<'chatroom_fileAttachments'>;
  chatroomId: Id<'chatroom_rooms'>;
  chatroomDeleted: boolean;
  chatroomName?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  attachedAt?: number;
  messageId?: Id<'chatroom_messages'>;
}

type SortOrder = 'largest' | 'oldest';
type AttachmentId = Id<'chatroom_fileAttachments'>;
type DownloadFn = (id: string, url: string, filename: string) => Promise<void>;

function previewable(kind: FileRowKind): boolean {
  return kind === 'image' || kind === 'text' || kind === 'markdown';
}

/** Distinguishes a removed chatroom from a live one that has no name. */
function chatroomLabel(file: FileListItem): string {
  if (file.chatroomDeleted) return 'Deleted chatroom';
  return file.chatroomName ?? 'Untitled chatroom';
}

function rowMeta(file: FileListItem, showChatroom: boolean): string {
  const parts = [formatFileSize(file.sizeBytes), fileExtensionLabel(file.filename)];
  if (showChatroom) parts.push(chatroomLabel(file));
  if (file.attachedAt !== undefined) {
    parts.push(
      new Date(file.attachedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    );
  }
  return parts.join(' · ');
}

function openLabelFor(kind: FileRowKind, filename: string): string {
  if (kind === 'pdf') return `Open ${filename} (new tab)`;
  if (kind === 'download') return `Download ${filename}`;
  return `Preview ${filename}`;
}

/** The row's primary click: pdf opens a tab, unknown kinds download, else preview. */
function openAction(
  kind: FileRowKind,
  url: string | null,
  onDownload: () => void,
  onPreview: () => void
): (() => void) | undefined {
  if (!url) return undefined;
  if (kind === 'pdf') return () => window.open(url, '_blank', 'noopener,noreferrer');
  if (kind === 'download') return onDownload;
  return onPreview;
}

function rowOpen(
  missing: boolean,
  kind: FileRowKind,
  url: string | null,
  onDownload: () => void,
  onPreview: () => void
): (() => void) | undefined {
  return missing ? undefined : openAction(kind, url, onDownload, onPreview);
}

function resolveUrl(state: FileUrlState, id: AttachmentId): string | null {
  if (state.status !== 'ready') return null;
  return state.urlById.get(id) ?? null;
}

function isMissing(state: FileUrlState, url: string | null): boolean {
  return state.status === 'ready' && url === null;
}

function rowKind(missing: boolean, mimeType: string): FileRowKind {
  return missing ? 'unavailable' : getFilePreviewKind(mimeType);
}

function downloadIfReady(url: string | null, file: FileListItem, download: DownloadFn): void {
  if (url) void download(file._id, url, file.filename);
}

function openPdf(url: string | null): void {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function listArgs(
  sessionId: string | undefined,
  sort: SortOrder,
  chatroomId: Id<'chatroom_rooms'> | undefined
) {
  if (!sessionId) return 'skip' as const;
  return { sessionId, sort, ...(chatroomId ? { chatroomId } : {}) };
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Loading files">
      <Skeleton className="h-12 w-full rounded-none" />
      <Skeleton className="h-12 w-full rounded-none" />
      <Skeleton className="h-12 w-full rounded-none" />
    </div>
  );
}

function EmptyState({ chatroomScope }: { chatroomScope: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 border border-dashed border-chatroom-border px-3 py-4 text-center text-xs text-chatroom-text-muted">
      <FileKindIcon kind="download" size={16} />
      <span>
        {chatroomScope
          ? 'No files yet. Files agents attach to handoffs in this chatroom appear here.'
          : 'No files yet. Files agents attach to handoffs addressed to you appear here.'}
      </span>
    </div>
  );
}

function ListErrorFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2 border border-chatroom-border bg-chatroom-bg-tertiary px-3 py-2 text-xs text-chatroom-text-muted">
      <div className="flex items-center gap-2">
        <AlertTriangle size={12} className="text-chatroom-status-error" />
        <span>Files couldn&apos;t be loaded.</span>
      </div>
      <Button variant="outline" size="xs" onClick={onRetry} className="w-fit">
        <RotateCw size={12} />
        Retry
      </Button>
    </div>
  );
}

function RowAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  );
}

function PreviewAction({
  filename,
  disabled,
  onPreview,
}: {
  filename: string;
  disabled: boolean;
  onPreview: () => void;
}) {
  return (
    <RowAction label={`Preview ${filename}`} disabled={disabled} onClick={onPreview}>
      <Eye size={12} />
    </RowAction>
  );
}

function PdfAction({ filename, url }: { filename: string; url: string | null }) {
  return (
    <RowAction label={`Open ${filename} in new tab`} disabled={!url} onClick={() => openPdf(url)}>
      <ExternalLink size={12} />
    </RowAction>
  );
}

function DownloadAction({
  filename,
  url,
  downloading,
  onDownload,
}: {
  filename: string;
  url: string | null;
  downloading: boolean;
  onDownload: () => void;
}) {
  return (
    <RowAction label={`Download ${filename}`} disabled={!url || downloading} onClick={onDownload}>
      {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
    </RowAction>
  );
}

function deleteContent(armed: boolean, deleting: boolean): ReactNode {
  if (deleting) return <Loader2 size={12} className="animate-spin" />;
  return armed ? 'Confirm' : <Trash2 size={12} />;
}

function DeleteButton({
  filename,
  armed,
  deleting,
  onDelete,
}: {
  filename: string;
  armed: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const label = armed ? `Confirm delete ${filename}` : `Delete ${filename}`;
  const style = armed ? ARMED_DELETE : IDLE_DELETE;
  return (
    <Button
      variant={style.variant}
      size={style.size}
      onClick={onDelete}
      disabled={deleting}
      title={label}
      aria-label={label}
    >
      {deleteContent(armed, deleting)}
    </Button>
  );
}

function RowActions({
  file,
  kind,
  missing,
  url,
  armed,
  deleting,
  downloading,
  onPreview,
  onDownload,
  onDelete,
}: {
  file: FileListItem;
  kind: FileRowKind;
  missing: boolean;
  url: string | null;
  armed: boolean;
  deleting: boolean;
  downloading: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  if (missing) return null;
  return (
    <>
      {previewable(kind) && (
        <PreviewAction filename={file.filename} disabled={!url} onPreview={onPreview} />
      )}
      {kind === 'pdf' && <PdfAction filename={file.filename} url={url} />}
      <DownloadAction
        filename={file.filename}
        url={url}
        downloading={downloading}
        onDownload={onDownload}
      />
      <DeleteButton
        filename={file.filename}
        armed={armed}
        deleting={deleting}
        onDelete={onDelete}
      />
    </>
  );
}

/** One stored file; owns its URL subscription so deleted rows turn unavailable. */
function FileManagerRow({
  file,
  showChatroom,
  armed,
  deleting,
  onDelete,
}: {
  file: FileListItem;
  showChatroom: boolean;
  armed: boolean;
  deleting: boolean;
  onDelete: (id: AttachmentId) => void;
}) {
  const urlState = useFileAttachmentUrls([file._id]);
  const { downloadingId, download } = useAttachmentDownload();
  const [previewOpen, setPreviewOpen] = useState(false);

  const url = resolveUrl(urlState, file._id);
  const missing = isMissing(urlState, url);
  const kind = rowKind(missing, file.mimeType);
  const downloading = downloadingId === file._id;
  const handleDownload = () => downloadIfReady(url, file, download);
  const handlePreview = () => setPreviewOpen(true);

  return (
    <>
      <FileAttachmentRow
        filename={file.filename}
        meta={rowMeta(file, showChatroom)}
        kind={kind}
        busy={deleting}
        onOpen={rowOpen(missing, kind, url, handleDownload, handlePreview)}
        openLabel={openLabelFor(kind, file.filename)}
        actions={
          <RowActions
            file={file}
            kind={kind}
            missing={missing}
            url={url}
            armed={armed}
            deleting={deleting}
            downloading={downloading}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onDelete={() => onDelete(file._id)}
          />
        }
      />
      <FilePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        file={file}
        url={url}
      />
    </>
  );
}

/** Delete state for the whole list: one armed row and one in-flight delete. */
function useDeleteFile(files: FileListItem[]) {
  const deleteFile = useSessionMutation(api.fileAttachments.deleteFile);
  const [deletingId, setDeletingId] = useState<AttachmentId | null>(null);
  const confirm = useTwoTapConfirm<AttachmentId>(async (attachmentId) => {
    const target = files.find((file) => file._id === attachmentId);
    if (!target) return;
    setDeletingId(attachmentId);
    try {
      const result = await deleteFile({ attachmentId });
      if (result.deleted) {
        toast.success(`Deleted ${target.filename}`);
      } else {
        toast(`${target.filename} was already removed`);
      }
    } catch (err) {
      toast.error(getFileAttachmentErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  });

  const request = (attachmentId: AttachmentId) => {
    if (deletingId) return;
    void confirm.request(attachmentId);
  };

  return { deletingId, armedKey: confirm.armedKey, request };
}

function SortToggle({ sort, onChange }: { sort: SortOrder; onChange: (sort: SortOrder) => void }) {
  return (
    <div role="group" aria-label="Sort files" className="flex items-center gap-0.5">
      <Button
        variant={sort === 'largest' ? 'secondary' : 'ghost'}
        size="xs"
        aria-pressed={sort === 'largest'}
        onClick={() => onChange('largest')}
      >
        Largest
      </Button>
      <Button
        variant={sort === 'oldest' ? 'secondary' : 'ghost'}
        size="xs"
        aria-pressed={sort === 'oldest'}
        onClick={() => onChange('oldest')}
      >
        Oldest
      </Button>
    </div>
  );
}

function LoadMoreButton({
  status,
  onLoadMore,
}: {
  status: 'LoadingFirstPage' | 'LoadingMore' | 'CanLoadMore' | 'Exhausted';
  onLoadMore: () => void;
}) {
  if (status !== 'CanLoadMore' && status !== 'LoadingMore') return null;
  const loading = status === 'LoadingMore';
  return (
    <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
      {loading && <Loader2 size={12} className="animate-spin" />}
      Load more
    </Button>
  );
}

function FileManagerListContent({ chatroomId }: { chatroomId?: Id<'chatroom_rooms'> }) {
  const [sessionId] = useSessionId();
  const [sort, setSort] = useState<SortOrder>('largest');
  const paginated = usePaginatedQuery(
    api.fileAttachments.listFiles as PaginatedQueryReference,
    listArgs(sessionId, sort, chatroomId),
    { initialNumItems: PAGE_SIZE }
  );
  const files = paginated.results as FileListItem[];
  const { deletingId, armedKey, request } = useDeleteFile(files);

  if (paginated.status === 'LoadingFirstPage') return <ListSkeleton />;
  if (files.length === 0) return <EmptyState chatroomScope={chatroomId !== undefined} />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Files
        </span>
        <SortToggle sort={sort} onChange={setSort} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {files.map((file) => (
          <li key={file._id} className="min-w-0">
            <FileManagerRow
              file={file}
              showChatroom={chatroomId === undefined}
              armed={armedKey === file._id}
              deleting={deletingId === file._id}
              onDelete={request}
            />
          </li>
        ))}
      </ul>
      <LoadMoreButton status={paginated.status} onLoadMore={() => paginated.loadMore(PAGE_SIZE)} />
    </div>
  );
}

/**
 * Paginated stored-file list for one scope. The same component serves the
 * account profile and the chatroom Files tab; only `chatroomId` differs.
 *
 * The `ErrorBoundary` key is parent-owned so Retry remounts the list and
 * re-subscribes the paginated query.
 */
export function FileManagerList({ chatroomId }: { chatroomId?: Id<'chatroom_rooms'> }) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <ErrorBoundary
      key={retryKey}
      fallback={<ListErrorFallback onRetry={() => setRetryKey((key) => key + 1)} />}
    >
      <FileManagerListContent chatroomId={chatroomId} />
    </ErrorBoundary>
  );
}
