'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { handleDialogSaveKeyDown, validateEntryName } from './explorerDialogInputUtils';
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
import { useWorkspaceFileRename } from '../hooks/useWorkspaceFileRename';
import { validateRelativeFilePath } from '../utils/gzipContent';

import { cn } from '@/lib/utils';

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machineId: string;
  workingDir: string;
  targetPath: string;
  targetType: 'file' | 'directory';
  onRenamed: (oldPath: string, newPath: string) => void;
  onRenameFailed?: (oldPath: string, error: string) => void;
  onRenameConfirmed?: (oldPath: string, newPath: string) => void;
  onExplorerRefresh?: () => void;
}

function splitParentAndBase(path: string): { parentDir: string; baseName: string } {
  const idx = path.lastIndexOf('/');
  if (idx === -1) return { parentDir: '', baseName: path };
  return { parentDir: path.slice(0, idx), baseName: path.slice(idx + 1) };
}

// fallow-ignore-next-line complexity
export function RenameDialog({
  open,
  onOpenChange,
  machineId,
  workingDir,
  targetPath,
  targetType,
  onRenamed,
  onRenameFailed,
  onRenameConfirmed,
  onExplorerRefresh,
}: RenameDialogProps) {
  const { requestRename, confirmRename } = useWorkspaceFileRename({ machineId, workingDir });

  const { parentDir, baseName } = useMemo(() => splitParentAndBase(targetPath), [targetPath]);
  const [baseNameInput, setBaseNameInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setBaseNameInput(baseName);
    setValidationError(null);
  }, [baseName, open, targetPath]);

  const runBackgroundRename = useCallback(
    // fallow-ignore-next-line complexity
    async (oldPath: string, newPath: string) => {
      try {
        const { requestId } = await requestRename(oldPath, newPath);
        await confirmRename(requestId);
        onExplorerRefresh?.();
        onRenameConfirmed?.(oldPath, newPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to rename';
        onRenameFailed?.(oldPath, message);
        onExplorerRefresh?.();
      }
    },
    [confirmRename, onExplorerRefresh, onRenameConfirmed, onRenameFailed, requestRename]
  );

  // fallow-ignore-next-line complexity
  const handleRename = useCallback(() => {
    const trimmed = baseNameInput.trim();
    const newPath = parentDir ? `${parentDir}/${trimmed}` : trimmed;

    if (newPath === targetPath) {
      setValidationError('Name is unchanged');
      return;
    }

    const baseError = validateEntryName(baseNameInput, 'Name');
    const pathError = baseError ?? validateRelativeFilePath(newPath);
    if (pathError) {
      setValidationError(pathError);
      return;
    }

    setValidationError(null);
    onRenamed(targetPath, newPath);
    onOpenChange(false);
    void runBackgroundRename(targetPath, newPath);
  }, [baseNameInput, onOpenChange, onRenamed, parentDir, runBackgroundRename, targetPath]);

  const kbdClassName = 'rounded-none border border-chatroom-border px-1';
  const title = targetType === 'directory' ? 'Rename Folder' : 'Rename File';
  const ariaLabel = parentDir ? `New name in ${parentDir}` : 'New file name';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent floating
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Enter a new name
            {parentDir ? (
              <>
                {' '}
                in <code className="font-mono">{parentDir}/</code>
              </>
            ) : null}
            . Press <kbd className={kbdClassName}>⌘S</kbd> to save.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div
            className={cn(
              'flex items-center overflow-hidden rounded-none border bg-chatroom-bg-secondary',
              validationError ? chatroomIndustrialInputErrorClassName : 'border-chatroom-border',
              !parentDir && 'hidden'
            )}
          >
            {parentDir ? (
              <>
                <span
                  className="shrink-0 border-r border-chatroom-border px-3 py-2 text-sm font-mono text-chatroom-text-muted select-none"
                  aria-hidden
                >
                  {parentDir}/
                </span>
                <input
                  ref={inputRef}
                  value={baseNameInput}
                  onChange={(event) => {
                    setBaseNameInput(event.target.value);
                    setValidationError(null);
                  }}
                  placeholder="notes.md"
                  aria-label={ariaLabel}
                  className="h-9 w-full border-0 bg-transparent px-3 text-sm text-chatroom-text-primary outline-none placeholder:text-chatroom-text-muted"
                  onKeyDown={(event) => handleDialogSaveKeyDown(event, handleRename)}
                />
              </>
            ) : null}
          </div>
          {!parentDir ? (
            <input
              ref={inputRef}
              value={baseNameInput}
              onChange={(event) => {
                setBaseNameInput(event.target.value);
                setValidationError(null);
              }}
              placeholder="package.json"
              aria-label={ariaLabel}
              className={cn(
                'h-9 w-full px-3 text-sm',
                chatroomIndustrialInputClassName,
                validationError && chatroomIndustrialInputErrorClassName
              )}
              onKeyDown={(event) => handleDialogSaveKeyDown(event, handleRename)}
            />
          ) : null}
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
            onClick={handleRename}
            className={chatroomIndustrialButtonPrimaryClassName}
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
