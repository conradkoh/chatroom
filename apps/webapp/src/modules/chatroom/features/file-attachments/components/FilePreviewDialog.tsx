'use client';

import { getFilePreviewKind } from '@workspace/shared/domain/file-attachment';
import { AlertTriangle, Download, FileX, Loader2, RotateCw } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';

import { FileAttachmentRow, type FileRowKind } from './FileAttachmentRow';
import { chatroomRemarkPlugins } from '../../../components/chatroomRemarkPlugins';
import {
  messageFeedProseClassNames,
  modalMarkdownComponents,
} from '../../../components/markdown-utils';
import { useAttachmentDownload } from '../hooks/useAttachmentDownload';
import { TEXT_PREVIEW_MAX_BYTES, useFileTextContent } from '../hooks/useFileTextContent';
import { fileExtensionLabel, formatFileSize } from '../lib/formatFileSize';

import { Button } from '@/components/ui/button';
import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
} from '@/components/ui/fixed-modal';
import { cn } from '@/lib/utils';

export interface FilePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  file: { _id: string; filename: string; mimeType: string; sizeBytes: number };
  /** Parent-owned so a deleted file turns into the gone state reactively. */
  url: string | null;
}

const GONE_MESSAGE = 'This file is no longer available.';

const TEXT_PREVIEW_MAX_LABEL = (TEXT_PREVIEW_MAX_BYTES / 1024).toString() + ' KB';

function TruncationNote({ sizeBytes }: { sizeBytes: number }) {
  return (
    <p className="m-0 border-t border-chatroom-border px-4 py-2 text-[10px] uppercase tracking-wide text-chatroom-text-muted">
      Showing first {TEXT_PREVIEW_MAX_LABEL} of {formatFileSize(sizeBytes)}. Download for the full
      file.
    </p>
  );
}

function PreviewMessage({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-xs text-chatroom-text-muted">
      {children}
      {actions && <div className="mt-2 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Image body; remounted by a key on retry so the browser refetches. */
function ImagePreview({
  url,
  filename,
  onRetry,
  onDownload,
}: {
  url: string;
  filename: string;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  if (status === 'error') {
    return (
      <PreviewMessage>
        <AlertTriangle size={24} className="text-chatroom-status-error" />
        <span>Couldn&apos;t load this image.</span>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="outline" size="xs" onClick={onRetry}>
            <RotateCw size={12} />
            Retry
          </Button>
          <Button variant="outline" size="xs" onClick={onDownload}>
            <Download size={12} />
            Download
          </Button>
        </div>
      </PreviewMessage>
    );
  }

  return (
    <div className="relative flex min-h-[40vh] items-center justify-center bg-chatroom-bg-tertiary p-4">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-chatroom-text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading preview…
        </div>
      )}
      <img
        src={url}
        alt={filename}
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
        className={cn(
          'max-h-[70vh] max-w-full object-contain',
          status === 'loading' && 'invisible'
        )}
      />
    </div>
  );
}

function FileLoadState({
  status,
  retry,
  onDownload,
}: {
  status: 'idle' | 'loading' | 'error';
  retry: () => void;
  onDownload: () => void;
}) {
  if (status === 'error') {
    return (
      <PreviewMessage>
        <AlertTriangle size={24} className="text-chatroom-status-error" />
        <span>Couldn&apos;t load this file.</span>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="outline" size="xs" onClick={retry}>
            <RotateCw size={12} />
            Retry
          </Button>
          <Button variant="outline" size="xs" onClick={onDownload}>
            <Download size={12} />
            Download
          </Button>
        </div>
      </PreviewMessage>
    );
  }

  return (
    <PreviewMessage>
      <Loader2 size={24} className="animate-spin" />
      <span>Loading file…</span>
    </PreviewMessage>
  );
}

interface TextFileBodyProps {
  url: string;
  open: boolean;
  sizeBytes: number;
  onDownload: () => void;
}

function TextFileBody({
  url,
  open,
  sizeBytes,
  onDownload,
  renderText,
}: TextFileBodyProps & { renderText: (text: string) => ReactNode }) {
  const state = useFileTextContent(url, open);

  if (state.status !== 'ready') {
    return <FileLoadState status={state.status} retry={state.retry} onDownload={onDownload} />;
  }

  return (
    <>
      {renderText(state.text)}
      {state.truncated && <TruncationNote sizeBytes={sizeBytes} />}
    </>
  );
}

function TextPreview(props: TextFileBodyProps) {
  return (
    <TextFileBody
      {...props}
      renderText={(text) => (
        <pre
          data-testid="file-preview-text"
          className="m-0 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-chatroom-text-primary"
        >
          {text}
        </pre>
      )}
    />
  );
}

function MarkdownPreview(props: TextFileBodyProps) {
  return (
    <TextFileBody
      {...props}
      renderText={(text) => (
        <div className={cn('min-w-0 overflow-x-hidden p-4', messageFeedProseClassNames)}>
          <Markdown remarkPlugins={chatroomRemarkPlugins} components={modalMarkdownComponents}>
            {text}
          </Markdown>
        </div>
      )}
    />
  );
}

function GonePreview() {
  return (
    <PreviewMessage>
      <FileX size={24} />
      <span>{GONE_MESSAGE}</span>
    </PreviewMessage>
  );
}

function UnsupportedPreview() {
  return (
    <PreviewMessage>
      <AlertTriangle size={24} />
      <span>No preview available for this file type.</span>
    </PreviewMessage>
  );
}

/** Routes a resolved file to its kind-specific body. */
function AvailablePreview({
  kind,
  url,
  open,
  file,
  retryKey,
  onRetry,
  onDownload,
}: {
  kind: FileRowKind;
  url: string;
  open: boolean;
  file: FilePreviewDialogProps['file'];
  retryKey: number;
  onRetry: () => void;
  onDownload: () => void;
}) {
  if (kind === 'image') {
    return (
      <ImagePreview
        key={retryKey}
        url={url}
        filename={file.filename}
        onRetry={onRetry}
        onDownload={onDownload}
      />
    );
  }
  if (kind === 'text') {
    return <TextPreview url={url} open={open} sizeBytes={file.sizeBytes} onDownload={onDownload} />;
  }
  if (kind === 'markdown') {
    return (
      <MarkdownPreview url={url} open={open} sizeBytes={file.sizeBytes} onDownload={onDownload} />
    );
  }
  return <UnsupportedPreview />;
}

function PreviewBody({
  kind,
  url,
  open,
  file,
  retryKey,
  onRetry,
  onDownload,
}: {
  kind: FileRowKind;
  url: string | null;
  open: boolean;
  file: FilePreviewDialogProps['file'];
  retryKey: number;
  onRetry: () => void;
  onDownload: () => void;
}) {
  if (!url) return <GonePreview />;
  return (
    <AvailablePreview
      kind={kind}
      url={url}
      open={open}
      file={file}
      retryKey={retryKey}
      onRetry={onRetry}
      onDownload={onDownload}
    />
  );
}

/**
 * Full-size preview for image, text, and markdown attachments. The parent owns
 * the URL and the dialog owns only view state (image load, text fetch, retry).
 */
export function FilePreviewDialog({ open, onClose, file, url }: FilePreviewDialogProps) {
  const kind: FileRowKind = getFilePreviewKind(file.mimeType);
  const { downloadingId, download } = useAttachmentDownload();
  const [retryKey, setRetryKey] = useState(0);
  const busy = downloadingId === file._id;

  const handleDownload = () => {
    if (!url) return;
    void download(file._id, url, file.filename);
  };

  const downloadButton = url ? (
    <Button
      variant="outline"
      size="xs"
      onClick={handleDownload}
      disabled={busy}
      title="Download"
      aria-label={`Download ${file.filename}`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      Download
    </Button>
  ) : null;

  const retryImage = () => setRetryKey((key) => key + 1);

  return (
    <FixedModal isOpen={open} onClose={onClose} maxWidth="max-w-4xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileAttachmentRow
              className="flex-1 border-0 bg-transparent hover:border-0"
              filename={file.filename}
              meta={`${formatFileSize(file.sizeBytes)} · ${fileExtensionLabel(file.filename)}`}
              kind={url ? kind : 'unavailable'}
            />
            {downloadButton}
          </div>
        </FixedModalHeader>
        <FixedModalBody className="p-0">
          <PreviewBody
            kind={kind}
            url={url}
            open={open}
            file={file}
            retryKey={retryKey}
            onRetry={retryImage}
            onDownload={handleDownload}
          />
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}
