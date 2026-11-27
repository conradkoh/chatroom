'use client';

import { useRef } from 'react';

import { LedgerNotice } from './LedgerNotice';
import { backupWarningCopy } from '../lib/backupCopy';

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
import { chatroomIndustrialButtonPrimaryClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';
import { formatFileSize } from '@/modules/chatroom/features/file-attachments/lib/formatFileSize';
import { formatTimestampFull } from '@/modules/chatroom/utils/chatroomTimestamp';

export interface BackupDownloadWarningDialogProps {
  filename: string;
  sizeBytes: number;
  modifiedAt: number;
  machineName: string;
  onConfirm(): void;
  onClose(): void;
}

const SECTION_HEADING_CLASS =
  'text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted';

/**
 * Sensitive-action warning before preparing an ephemeral download. Initial focus is Cancel, and
 * the confirm button is non-destructive (primary) rather than the dialog's default destructive.
 */
export function BackupDownloadWarningDialog({
  filename,
  sizeBytes,
  modifiedAt,
  machineName,
  onConfirm,
  onClose,
}: BackupDownloadWarningDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent data-testid="backup-warning-dialog" initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>Download this backup?</AlertDialogTitle>
          <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
            <p className="break-all border border-chatroom-border bg-chatroom-bg-tertiary px-2 py-1.5 font-mono text-[10px]">
              {filename} · {formatFileSize(sizeBytes)} · {formatTimestampFull(modifiedAt)}
            </p>
            <LedgerNotice testId="backup-warning">{backupWarningCopy(machineName)}</LedgerNotice>
            <section className="space-y-1">
              <h3 className={SECTION_HEADING_CLASS}>What happens</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                <li>The daemon uploads a temporary copy to the cloud. Only you can download it.</li>
                <li>The copy is deleted when your browser has received it, or after 1 hour.</li>
                <li>The backup on the machine is not changed or removed.</li>
              </ul>
            </section>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={chatroomIndustrialButtonPrimaryClassName}
            data-testid="backup-warning-confirm"
            onClick={(event) => {
              event.preventDefault();
              event.preventBaseUIHandler();
              onConfirm();
            }}
          >
            Prepare download
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
