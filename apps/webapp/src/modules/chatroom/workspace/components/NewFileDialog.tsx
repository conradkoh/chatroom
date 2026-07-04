'use client';

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
  chatroomIndustrialInputClassName,
  chatroomIndustrialInputErrorClassName,
} from '../../components/shared/industrialDialogStyles';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useWorkspaceFileCreate } from '../hooks/useWorkspaceFileCreate';
import { normalizeNewFilePath, validateRelativeFilePath } from '../utils/gzipContent';

import { cn } from '@/lib/utils';

interface NewFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machineId: string;
  workingDir: string;
  defaultDir?: string;
  onCreated: (filePath: string) => void;
  onCreateFailed?: (filePath: string, error: string) => void;
  onCreateConfirmed?: (filePath: string) => void;
  onExplorerRefresh?: () => void;
}

// fallow-ignore-next-line complexity
function validateFileName(fileName: string): string | null {
  const trimmed = fileName.trim();
  if (!trimmed) return 'File name is required';
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'Enter a file name only';
  if (trimmed.includes('..')) return 'Invalid file name';
  if (trimmed.includes('\0')) return 'Invalid file name';
  return null;
}

// fallow-ignore-next-line complexity
function handleDialogSaveKeyDown(event: KeyboardEvent<HTMLInputElement>, onSave: () => void): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    onSave();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    onSave();
  }
}

// fallow-ignore-next-line complexity
export function NewFileDialog({
  open,
  onOpenChange,
  machineId,
  workingDir,
  defaultDir,
  onCreated,
  onCreateFailed,
  onCreateConfirmed,
  onExplorerRefresh,
}: NewFileDialogProps) {
  const { createFile } = useWorkspaceFileCreate({ machineId, workingDir });

  const targetDir = useMemo(() => (defaultDir ? defaultDir.replace(/\/$/, '') : ''), [defaultDir]);
  const isFolderCreate = targetDir !== '';

  const [pathInput, setPathInput] = useState('');
  const [fileNameInput, setFileNameInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPathInput('');
    setFileNameInput('');
    setValidationError(null);
  }, [defaultDir, open]);

  const runBackgroundCreate = useCallback(
    // fallow-ignore-next-line complexity
    async (normalizedPath: string) => {
      try {
        await createFile(normalizedPath, '');
        onExplorerRefresh?.();
        onCreateConfirmed?.(normalizedPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create file';
        onCreateFailed?.(normalizedPath, message);
      }
    },
    [createFile, onCreateConfirmed, onCreateFailed, onExplorerRefresh]
  );

  // fallow-ignore-next-line complexity
  const handleCreate = useCallback(() => {
    const normalizedPath = isFolderCreate
      ? normalizeNewFilePath(`${targetDir}/${fileNameInput.trim()}`)
      : normalizeNewFilePath(pathInput);

    const pathError = isFolderCreate
      ? (validateFileName(fileNameInput) ?? validateRelativeFilePath(normalizedPath))
      : validateRelativeFilePath(normalizedPath);
    if (pathError) {
      setValidationError(pathError);
      return;
    }

    setValidationError(null);
    onCreated(normalizedPath);
    onOpenChange(false);
    void runBackgroundCreate(normalizedPath);
  }, [
    fileNameInput,
    isFolderCreate,
    onCreated,
    onOpenChange,
    pathInput,
    runBackgroundCreate,
    targetDir,
  ]);

  const kbdClassName = 'rounded-none border border-chatroom-border px-1';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New File</DialogTitle>
          <DialogDescription>
            {isFolderCreate ? (
              <>
                Enter a file name in <code className="font-mono">{targetDir}/</code>. Press{' '}
                <kbd className={kbdClassName}>⌘S</kbd> to save. Files without an extension default
                to <code>.md</code>.
              </>
            ) : (
              <>
                Enter a relative path. Press <kbd className={kbdClassName}>⌘S</kbd> to save. Files
                without an extension default to <code>.md</code>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {isFolderCreate ? (
            <div
              className={cn(
                'flex items-center overflow-hidden rounded-none border bg-chatroom-bg-secondary',
                validationError ? chatroomIndustrialInputErrorClassName : 'border-chatroom-border'
              )}
            >
              <span
                className="shrink-0 border-r border-chatroom-border px-3 py-2 text-sm font-mono text-chatroom-text-muted select-none"
                aria-hidden
              >
                {targetDir}/
              </span>
              <input
                value={fileNameInput}
                onChange={(event) => {
                  setFileNameInput(event.target.value);
                  setValidationError(null);
                }}
                placeholder="notes.md"
                aria-label={`File name in ${targetDir}`}
                className="h-9 w-full border-0 bg-transparent px-3 text-sm text-chatroom-text-primary outline-none placeholder:text-chatroom-text-muted"
                autoFocus
                onKeyDown={(event) => handleDialogSaveKeyDown(event, handleCreate)}
              />
            </div>
          ) : (
            <input
              value={pathInput}
              onChange={(event) => {
                setPathInput(event.target.value);
                setValidationError(null);
              }}
              placeholder="docs/notes.md"
              aria-label="Relative file path"
              className={cn(
                'h-9 w-full px-3 text-sm',
                chatroomIndustrialInputClassName,
                validationError && chatroomIndustrialInputErrorClassName
              )}
              autoFocus
              onKeyDown={(event) => handleDialogSaveKeyDown(event, handleCreate)}
            />
          )}
          {validationError && (
            <p className="text-xs text-chatroom-status-error">{validationError}</p>
          )}
        </div>

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
