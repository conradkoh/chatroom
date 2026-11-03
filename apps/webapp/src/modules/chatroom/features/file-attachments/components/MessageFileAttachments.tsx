'use client';

import type { AttachedFileView } from '@workspace/backend/src/domain/entities/file-attachment';
import {
  FILE_ATTACHMENT_MAX_PER_HANDOFF,
  FILE_ATTACHMENT_THUMBNAIL_AUTOLOAD_MAX_BYTES,
  getFilePreviewKind,
} from '@workspace/shared/domain/file-attachment';
import { AlertTriangle, Download, ExternalLink, FileImage, Loader2, Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { FileAttachmentRow, type FileRowKind } from './FileAttachmentRow';
import { FilePreviewDialog } from './FilePreviewDialog';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { useAttachmentDownload } from '../hooks/useAttachmentDownload';
import { useFileAttachmentUrls, type FileUrlState } from '../hooks/useFileAttachmentUrls';
import { fileExtensionLabel, formatFileSize } from '../lib/formatFileSize';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type AvailableFile = Extract<AttachedFileView, { status: 'available' }>;

function isAvailable(file: AttachedFileView): file is AvailableFile {
  return file.status === 'available';
}

function urlFrom(urlById: Map<string, string | null>, id: string): string | null {
  return urlById.get(id) ?? null;
}

function fileMeta(file: AvailableFile): string {
  return `${formatFileSize(file.sizeBytes)} · ${fileExtensionLabel(file.filename)}`;
}

function findPreviewFile(
  files: AttachedFileView[],
  previewId: string | null
): AvailableFile | undefined {
  if (previewId === null) return undefined;
  return files.find((file): file is AvailableFile => isAvailable(file) && file._id === previewId);
}

function resolvePreviewUrl(
  previewFile: AvailableFile | undefined,
  urlState: FileUrlState
): string | null {
  if (!previewFile || urlState.status !== 'ready') return null;
  return urlState.urlById.get(previewFile._id) ?? null;
}

/** Trailing icon button: spinner while this file downloads, disabled meanwhile. */
function DownloadAction({
  file,
  url,
  downloadingId,
  onDownload,
}: {
  file: AvailableFile;
  url: string | null;
  downloadingId: string | null;
  onDownload: () => void;
}) {
  const busy = downloadingId === file._id;
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onDownload}
      disabled={!url || busy}
      title="Download"
      aria-label={`Download ${file.filename}`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
    </Button>
  );
}

function PdfOpenAction({ file, url }: { file: AvailableFile; url: string | null }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => {
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      }}
      disabled={!url}
      title="Open in new tab"
      aria-label={`Open ${file.filename} in new tab`}
    >
      <ExternalLink size={12} />
    </Button>
  );
}

/** Click target and load state for an image's timeline thumbnail. */
function AttachmentThumbnail({
  file,
  url,
  showMedia,
  kind,
  loadRequested,
  hasError,
  attempt,
  onRequestLoad,
  onRetry,
  onOpen,
  onError,
}: {
  file: AvailableFile;
  url: string;
  showMedia: boolean;
  kind: FileRowKind;
  loadRequested: boolean;
  hasError: boolean;
  attempt: number | undefined;
  onRequestLoad: () => void;
  onRetry: () => void;
  onOpen: () => void;
  onError: () => void;
}) {
  if (!showMedia || kind !== 'image') return null;
  if (hasError) {
    return (
      <div className="flex h-32 w-full flex-col items-center justify-center gap-1 bg-chatroom-bg-secondary text-[10px] uppercase tracking-wider text-chatroom-text-muted">
        <span>Preview unavailable</span>
        <Button variant="link" size="xs" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <ThumbnailImage
      file={file}
      url={url}
      loadRequested={loadRequested}
      attempt={attempt}
      onRequestLoad={onRequestLoad}
      onOpen={onOpen}
      onError={onError}
    />
  );
}

function ThumbnailImage({
  file,
  url,
  loadRequested,
  attempt,
  onRequestLoad,
  onOpen,
  onError,
}: {
  file: AvailableFile;
  url: string;
  loadRequested: boolean;
  attempt: number | undefined;
  onRequestLoad: () => void;
  onOpen: () => void;
  onError: () => void;
}) {
  const autoLoads = file.sizeBytes <= FILE_ATTACHMENT_THUMBNAIL_AUTOLOAD_MAX_BYTES;
  if (!autoLoads && !loadRequested) {
    return (
      <button
        type="button"
        onClick={onRequestLoad}
        className="flex h-32 w-full items-center justify-center gap-1.5 bg-chatroom-bg-secondary text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-text-primary"
      >
        <FileImage size={14} />
        Load preview · {formatFileSize(file.sizeBytes)}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Preview ${file.filename}`}
      onClick={onOpen}
      className="block h-32 w-full overflow-hidden bg-chatroom-bg-secondary"
    >
      <img
        key={`${file._id}:${attempt ?? 0}`}
        src={url}
        alt={file.filename}
        loading="lazy"
        onError={onError}
        className="h-full w-full object-cover"
      />
    </button>
  );
}

/** Row shown while `getFileUrls` is in flight: layout holds, actions disabled. */
function LoadingAttachmentRow({
  file,
  showMedia,
  downloadingId,
}: {
  file: AvailableFile;
  showMedia: boolean;
  downloadingId: string | null;
}) {
  const kind = getFilePreviewKind(file.mimeType);
  return (
    <FileAttachmentRow
      filename={file.filename}
      meta={fileMeta(file)}
      kind={kind}
      media={
        showMedia && kind === 'image' ? (
          <Skeleton className="h-32 w-full rounded-none" />
        ) : undefined
      }
      actions={
        <>
          {kind === 'pdf' && <PdfOpenAction file={file} url={null} />}
          <DownloadAction
            file={file}
            url={null}
            downloadingId={downloadingId}
            onDownload={() => undefined}
          />
        </>
      }
    />
  );
}

function openFor(
  kind: FileRowKind,
  url: string,
  onDownload: () => void,
  onPreview: () => void
): () => void {
  if (kind === 'pdf') return () => window.open(url, '_blank', 'noopener,noreferrer');
  if (kind === 'download') return onDownload;
  return onPreview;
}

function openLabelFor(kind: FileRowKind, filename: string): string {
  if (kind === 'pdf') return `Open ${filename} (new tab)`;
  if (kind === 'download') return `Download ${filename}`;
  return `Preview ${filename}`;
}

function ReadyAttachmentRow({
  file,
  url,
  kind,
  media,
  downloadingId,
  onDownload,
  onPreview,
}: {
  file: AvailableFile;
  url: string;
  kind: FileRowKind;
  media: ReactNode;
  downloadingId: string | null;
  onDownload: () => void;
  onPreview: () => void;
}) {
  return (
    <FileAttachmentRow
      filename={file.filename}
      meta={fileMeta(file)}
      kind={kind}
      onOpen={openFor(kind, url, onDownload, onPreview)}
      openLabel={openLabelFor(kind, file.filename)}
      media={media}
      actions={
        <>
          {kind === 'pdf' && <PdfOpenAction file={file} url={url} />}
          <DownloadAction
            file={file}
            url={url}
            downloadingId={downloadingId}
            onDownload={onDownload}
          />
        </>
      }
    />
  );
}

function FileAttachmentItem({
  file,
  urlState,
  showMedia,
  downloadingId,
  download,
  onPreview,
  loadRequested,
  hasThumbError,
  thumbAttempt,
  onRequestThumbLoad,
  onRetryThumb,
  onThumbError,
}: {
  file: AttachedFileView;
  urlState: FileUrlState;
  showMedia: boolean;
  downloadingId: string | null;
  download: (id: string, url: string, filename: string) => Promise<void>;
  onPreview: (id: string) => void;
  loadRequested: Set<string>;
  hasThumbError: Set<string>;
  thumbAttempt: Record<string, number>;
  onRequestThumbLoad: (id: string) => void;
  onRetryThumb: (id: string) => void;
  onThumbError: (id: string) => void;
}) {
  if (!isAvailable(file)) {
    return (
      <FileAttachmentRow
        filename="File removed"
        meta="Deleted to free storage"
        kind="unavailable"
      />
    );
  }

  if (urlState.status === 'loading') {
    return <LoadingAttachmentRow file={file} showMedia={showMedia} downloadingId={downloadingId} />;
  }

  const url = urlFrom(urlState.urlById, file._id);
  if (!url) {
    return (
      <FileAttachmentRow filename={file.filename} meta="No longer available" kind="unavailable" />
    );
  }

  const kind: FileRowKind = getFilePreviewKind(file.mimeType);
  const downloadFile = () => void download(file._id, url, file.filename);
  const media = (
    <AttachmentThumbnail
      file={file}
      url={url}
      showMedia={showMedia}
      kind={kind}
      loadRequested={loadRequested.has(file._id)}
      hasError={hasThumbError.has(file._id)}
      attempt={thumbAttempt[file._id]}
      onRequestLoad={() => onRequestThumbLoad(file._id)}
      onRetry={() => onRetryThumb(file._id)}
      onOpen={() => onPreview(file._id)}
      onError={() => onThumbError(file._id)}
    />
  );

  return (
    <ReadyAttachmentRow
      file={file}
      url={url}
      kind={kind}
      media={media}
      downloadingId={downloadingId}
      onDownload={downloadFile}
      onPreview={() => onPreview(file._id)}
    />
  );
}

/**
 * The message's file strip: header, one row per file, and the preview dialog.
 * The `ErrorBoundary` key is parent-owned so Retry remounts the list and
 * re-subscribes `getFileUrls`.
 */
export function MessageFileAttachments({
  files,
  showMedia,
}: {
  files: AttachedFileView[];
  showMedia: boolean;
}) {
  const [retryKey, setRetryKey] = useState(0);

  if (files.length === 0) return null;

  const availableSize = files
    .filter(isAvailable)
    .reduce((total, file) => total + file.sizeBytes, 0);

  return (
    <section
      data-testid="message-file-attachments"
      aria-label="Attached files"
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
        <Paperclip size={10} aria-hidden="true" />
        {`${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatFileSize(availableSize)}`}
      </div>
      <ErrorBoundary
        key={retryKey}
        fallback={
          <div className="flex items-center gap-2 text-xs text-chatroom-text-muted">
            <AlertTriangle size={12} className="text-chatroom-status-error" />
            <span>Files couldn&apos;t be loaded.</span>
            <Button variant="outline" size="xs" onClick={() => setRetryKey((key) => key + 1)}>
              Retry
            </Button>
          </div>
        }
      >
        <FileAttachmentList files={files} showMedia={showMedia} />
      </ErrorBoundary>
    </section>
  );
}

function FileAttachmentList({
  files,
  showMedia,
}: {
  files: AttachedFileView[];
  showMedia: boolean;
}) {
  const availableIds = files
    .filter(isAvailable)
    .map((file) => file._id)
    .slice(0, FILE_ATTACHMENT_MAX_PER_HANDOFF);
  const urlState = useFileAttachmentUrls(availableIds);
  const { downloadingId, download } = useAttachmentDownload();

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [loadRequested, setLoadRequested] = useState<Set<string>>(new Set());
  const [thumbErrors, setThumbErrors] = useState<Set<string>>(new Set());
  const [thumbAttempts, setThumbAttempts] = useState<Record<string, number>>({});

  const requestThumbLoad = (id: string) => {
    setLoadRequested((previous) => new Set(previous).add(id));
  };

  const retryThumbnail = (id: string) => {
    setThumbErrors((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setThumbAttempts((previous) => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }));
  };

  const markThumbnailError = (id: string) => {
    setThumbErrors((previous) => new Set(previous).add(id));
  };

  const previewFile = findPreviewFile(files, previewId);
  const previewUrl = resolvePreviewUrl(previewFile, urlState);

  return (
    <>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
        {files.map((file) => (
          <li key={file._id} className="min-w-0">
            <FileAttachmentItem
              file={file}
              urlState={urlState}
              showMedia={showMedia}
              downloadingId={downloadingId}
              download={download}
              onPreview={setPreviewId}
              loadRequested={loadRequested}
              hasThumbError={thumbErrors}
              thumbAttempt={thumbAttempts}
              onRequestThumbLoad={requestThumbLoad}
              onRetryThumb={retryThumbnail}
              onThumbError={markThumbnailError}
            />
          </li>
        ))}
      </ul>
      {previewFile && (
        <FilePreviewDialog
          open
          onClose={() => setPreviewId(null)}
          file={previewFile}
          url={previewUrl}
        />
      )}
    </>
  );
}
