'use client';

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
import { useWorkspaceFileMkdir } from '../hooks/useWorkspaceFileMkdir';
import { validateRelativeFilePath } from '../utils/gzipContent';

interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machineId: string;
  workingDir: string;
  defaultDir?: string;
  onCreated: (dirPath: string) => void;
  onCreateFailed?: (dirPath: string, error: string) => void;
  onCreateConfirmed?: (dirPath: string) => void;
  onExplorerRefresh?: () => void;
}

// fallow-ignore-next-line complexity
export function NewFolderDialog({
  open,
  onOpenChange,
  machineId,
  workingDir,
  defaultDir,
  onCreated,
  onCreateFailed,
  onCreateConfirmed,
  onExplorerRefresh,
}: NewFolderDialogProps) {
  const { requestMkdir, confirmMkdir } = useWorkspaceFileMkdir({ machineId, workingDir });

  const targetDir = useMemo(() => (defaultDir ? defaultDir.replace(/\/$/, '') : ''), [defaultDir]);
  const isNestedCreate = targetDir !== '';

  const [pathInput, setPathInput] = useState('');
  const [folderNameInput, setFolderNameInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPathInput('');
    setFolderNameInput('');
    setValidationError(null);
  }, [defaultDir, open]);

  const runBackgroundMkdir = useCallback(
    // fallow-ignore-next-line complexity
    async (dirPath: string) => {
      try {
        const { requestId } = await requestMkdir(dirPath);
        await confirmMkdir(requestId);
        onExplorerRefresh?.();
        onCreateConfirmed?.(dirPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create folder';
        onCreateFailed?.(dirPath, message);
      }
    },
    [confirmMkdir, onCreateConfirmed, onCreateFailed, onExplorerRefresh, requestMkdir]
  );

  // fallow-ignore-next-line complexity
  const handleCreate = useCallback(() => {
    const dirPath = isNestedCreate ? `${targetDir}/${folderNameInput.trim()}` : pathInput.trim();

    const pathError = isNestedCreate
      ? (validateEntryName(folderNameInput, 'Folder name') ?? validateRelativeFilePath(dirPath))
      : validateRelativeFilePath(dirPath);
    if (pathError) {
      setValidationError(pathError);
      return;
    }

    setValidationError(null);
    onCreated(dirPath);
    onOpenChange(false);
    void runBackgroundMkdir(dirPath);
  }, [
    folderNameInput,
    isNestedCreate,
    onCreated,
    onOpenChange,
    pathInput,
    runBackgroundMkdir,
    targetDir,
  ]);

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
          <DialogTitle>New Folder</DialogTitle>
          <DialogDescription>
            {isNestedCreate ? (
              <>
                Enter a folder name in <code className="font-mono">{targetDir}/</code>. Press{' '}
                <kbd className={kbdClassName}>⌘S</kbd> to save.
              </>
            ) : (
              <>
                Enter a relative folder path. Press <kbd className={kbdClassName}>⌘S</kbd> to save.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <ExplorerDialogPathFields
          isNested={isNestedCreate}
          targetDir={targetDir}
          nestedValue={folderNameInput}
          onNestedChange={(value) => {
            setFolderNameInput(value);
            setValidationError(null);
          }}
          pathValue={pathInput}
          onPathChange={(value) => {
            setPathInput(value);
            setValidationError(null);
          }}
          nestedPlaceholder="components"
          rootPlaceholder="docs"
          nestedAriaLabel={`Folder name in ${targetDir}`}
          rootAriaLabel="Relative folder path"
          inputRef={inputRef}
          validationError={validationError}
          onSave={handleCreate}
        />

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={chatroomIndustrialButtonSecondaryClassName}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className={chatroomIndustrialButtonPrimaryClassName}
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
