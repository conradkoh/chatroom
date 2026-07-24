'use client';
// fallow-ignore-file code-duplication complexity

import { getBlockedUploadTargetReason } from '@workspace/backend/src/domain/constants/workspace-upload-path-policy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { validateEntryName } from './explorerDialogInputUtils';
import { ExplorerDialogPathFields } from './ExplorerDialogPathFields';
import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../../components/shared/industrialDialogStyles';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useWorkspaceFileUpload } from '../hooks/useWorkspaceFileUpload';
import { validateRelativeFilePath } from '../utils/gzipContent';

interface UploadFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machineId: string;
  workingDir: string;
  targetDir: string;
  file: File | null;
  onUploaded: (filePath: string) => void;
  onUploadFailed?: (filePath: string, error: string) => void;
  onUploadConfirmed?: (filePath: string) => void;
  onExplorerRefresh?: () => void;
  onContinue?: () => void;
  remainingCount?: number;
}

function joinUploadPath(targetDir: string, fileName: string): string {
  const trimmedName = fileName.trim();
  if (!targetDir) return trimmedName;
  return `${targetDir.replace(/\/$/, '')}/${trimmedName}`;
}

// fallow-ignore-next-line complexity
export function UploadFileDialog({
  open,
  onOpenChange,
  machineId,
  workingDir,
  targetDir,
  file,
  onUploaded,
  onUploadFailed,
  onUploadConfirmed,
  onExplorerRefresh,
  onContinue,
  remainingCount = 0,
}: UploadFileDialogProps) {
  const { uploadFile, uploading } = useWorkspaceFileUpload({ machineId, workingDir });
  const normalizedTargetDir = useMemo(() => targetDir.replace(/\/$/, ''), [targetDir]);
  const [fileNameInput, setFileNameInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !file) return;
    setFileNameInput(file.name);
    setValidationError(null);
  }, [file, open, targetDir]);

  // fallow-ignore-next-line complexity
  const runBackgroundUpload = useCallback(
    async (normalizedPath: string, uploadBlob: File) => {
      try {
        await uploadFile(normalizedPath, uploadBlob);
        onExplorerRefresh?.();
        onUploadConfirmed?.(normalizedPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to upload file';
        onUploadFailed?.(normalizedPath, message);
      } finally {
        onContinue?.();
      }
    },
    [onContinue, onExplorerRefresh, onUploadConfirmed, onUploadFailed, uploadFile]
  );

  // fallow-ignore-next-line complexity
  const handleUpload = useCallback(() => {
    if (!file) return;

    const normalizedPath = joinUploadPath(normalizedTargetDir, fileNameInput);
    const nameError = validateEntryName(fileNameInput, 'File name');
    const pathError = nameError ?? validateRelativeFilePath(normalizedPath);
    const blockedReason = getBlockedUploadTargetReason(normalizedPath);

    if (pathError || blockedReason) {
      setValidationError(pathError ?? blockedReason);
      return;
    }

    setValidationError(null);
    onUploaded(normalizedPath);
    onOpenChange(false);
    void runBackgroundUpload(normalizedPath, file);
  }, [file, fileNameInput, normalizedTargetDir, onOpenChange, onUploaded, runBackgroundUpload]);

  const kbdClassName = 'rounded-none border border-chatroom-border px-1';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Upload File</DialogTitle>
          <DialogDescription>
            {normalizedTargetDir ? (
              <>
                Confirm the file name for upload to{' '}
                <code className="font-mono">{normalizedTargetDir}/</code>. Press{' '}
                <kbd className={kbdClassName}>Enter</kbd> to upload.
              </>
            ) : (
              <>
                Confirm the file name for upload to the workspace root. Press{' '}
                <kbd className={kbdClassName}>Enter</kbd> to upload.
              </>
            )}
            {remainingCount > 0 ? (
              <span className="block mt-2 text-chatroom-text-muted">
                {remainingCount} more file{remainingCount === 1 ? '' : 's'} queued after this one.
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <ExplorerDialogPathFields
          isNested
          targetDir={normalizedTargetDir}
          nestedValue={fileNameInput}
          onNestedChange={(value) => {
            setFileNameInput(value);
            setValidationError(null);
          }}
          pathValue=""
          onPathChange={() => {}}
          nestedPlaceholder={file?.name ?? 'document.pdf'}
          rootPlaceholder=""
          nestedAriaLabel={`File name in ${normalizedTargetDir || 'workspace root'}`}
          rootAriaLabel="Relative file path"
          inputRef={inputRef}
          validationError={validationError}
          onSave={handleUpload}
        />

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={chatroomIndustrialButtonSecondaryClassName}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            className={chatroomIndustrialButtonPrimaryClassName}
            disabled={uploading || !file}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
