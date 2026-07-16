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
import { useWorkspaceFileCreate } from '../hooks/useWorkspaceFileCreate';
import { normalizeNewFilePath, validateRelativeFilePath } from '../utils/gzipContent';

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
  const inputRef = useRef<HTMLInputElement>(null);

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
      ? (validateEntryName(fileNameInput, 'File name') ?? validateRelativeFilePath(normalizedPath))
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
      <DialogContent floating
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
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

        <ExplorerDialogPathFields
          isNested={isFolderCreate}
          targetDir={targetDir}
          nestedValue={fileNameInput}
          onNestedChange={(value) => {
            setFileNameInput(value);
            setValidationError(null);
          }}
          pathValue={pathInput}
          onPathChange={(value) => {
            setPathInput(value);
            setValidationError(null);
          }}
          nestedPlaceholder="notes.md"
          rootPlaceholder="docs/notes.md"
          nestedAriaLabel={`File name in ${targetDir}`}
          rootAriaLabel="Relative file path"
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
