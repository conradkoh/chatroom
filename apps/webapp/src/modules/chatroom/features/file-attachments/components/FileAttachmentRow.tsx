'use client';

import type { FilePreviewKind } from '@workspace/shared/domain/file-attachment';
import {
  File,
  FileCode,
  FileImage,
  FileText,
  FileType,
  FileX,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Preview kind plus the terminal state for deleted or expired files. */
export type FileRowKind = FilePreviewKind | 'unavailable';

export interface FileAttachmentRowProps {
  /** Removed rows pass "File removed". */
  filename: string;
  /** "1.2 MB · PNG" | "No longer available" | "Deleted to free storage". */
  meta: string;
  kind: FileRowKind;
  /** Undefined makes the name area non-interactive (removed/unavailable rows). */
  onOpen?: () => void;
  /** Accessible name: "Preview shot.png", "Open report.pdf in new tab". */
  openLabel?: string;
  /** Timeline image thumbnail only; omitted for collapsed rows. */
  media?: ReactNode;
  /** Icon buttons rendered at the trailing edge of the row. */
  actions?: ReactNode;
  /** Dims the row and blocks pointer events while a download is in flight. */
  busy?: boolean;
  className?: string;
}

/** Kind icons; one table so timeline, file manager, and dialog agree. */
const KIND_ICONS: Record<FileRowKind, LucideIcon> = {
  image: FileImage,
  pdf: FileType,
  text: FileCode,
  markdown: FileText,
  download: File,
  unavailable: FileX,
};

export function FileKindIcon({ kind, size = 14 }: { kind: FileRowKind; size?: number }) {
  const Icon = KIND_ICONS[kind];
  return <Icon size={size} aria-hidden="true" />;
}

/**
 * The single attachment row: icon, filename, meta line, and optional media and
 * actions. The chip look matches `AttachmentChipShell`.
 */
export function FileAttachmentRow({
  filename,
  meta,
  kind,
  onOpen,
  openLabel,
  media,
  actions,
  busy,
  className,
}: FileAttachmentRowProps) {
  return (
    <div
      data-testid="file-attachment-row"
      data-kind={kind}
      className={cn(
        'flex min-w-0 flex-col border border-chatroom-border bg-chatroom-bg-tertiary transition-colors hover:border-chatroom-border-strong',
        kind === 'unavailable' && 'border-dashed opacity-70 hover:border-chatroom-border',
        busy && 'pointer-events-none opacity-60',
        className
      )}
    >
      {media}
      <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          aria-label={openLabel}
          title={filename}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-chatroom-accent disabled:cursor-default"
        >
          <span className="flex size-8 shrink-0 items-center justify-center bg-chatroom-bg-secondary text-chatroom-text-muted">
            <FileKindIcon kind={kind} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-medium text-chatroom-text-primary">
              {filename}
            </span>
            <span className="truncate text-[10px] uppercase tracking-wide text-chatroom-text-muted">
              {meta}
            </span>
          </span>
        </button>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
    </div>
  );
}
