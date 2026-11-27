'use client';

import { Download } from 'lucide-react';

import { BACKUP_LIMIT_LABEL } from '../lib/backupCopy';

import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/modules/chatroom/features/file-attachments/lib/formatFileSize';
import { formatTimestampFull } from '@/modules/chatroom/utils/chatroomTimestamp';

export interface BackupRowProps {
  backup: { filename: string; sizeBytes: number; modifiedAt: number };
  /** True when the archive exceeds the download cap; the row then explains the limit. */
  tooLarge: boolean;
  disabled: boolean;
  disabledTitle?: string;
  /** True when this exact file is the machine's active download. */
  activeHere: boolean;
  onDownload(): void;
}

/** One inventory row: filename, modified stamp, size, limit warning and the Download action. */
export function BackupRow({
  backup,
  tooLarge,
  disabled,
  disabledTitle,
  activeHere,
  onDownload,
}: BackupRowProps) {
  return (
    <li
      data-testid="backup-row"
      data-filename={backup.filename}
      className="flex flex-col gap-2 border-b border-chatroom-border py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-mono text-xs font-bold" title={backup.filename}>
          {backup.filename}
        </p>
        <p className="text-[10px] text-chatroom-text-muted tabular-nums">
          {formatTimestampFull(backup.modifiedAt)} · {formatFileSize(backup.sizeBytes)}
        </p>
        {tooLarge && (
          <p className="text-[10px] text-chatroom-status-warning">
            Larger than the {BACKUP_LIMIT_LABEL} download limit. Copy it from the machine directly.
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        disabled={disabled}
        title={disabledTitle}
        aria-label={`Download ${backup.filename}`}
        onClick={onDownload}
        data-testid="backup-download"
      >
        <Download size={14} aria-hidden /> {activeHere ? 'In progress' : 'Download'}
      </Button>
    </li>
  );
}
