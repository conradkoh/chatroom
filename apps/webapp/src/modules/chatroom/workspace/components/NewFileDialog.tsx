'use client';

import { useCallback, useEffect, useState } from 'react';

import { useWorkspaceFileCreate } from '../hooks/useWorkspaceFileCreate';
import { normalizeNewFilePath, validateRelativeFilePath } from '../utils/gzipContent';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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

  const [pathInput, setPathInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPathInput(defaultDir ? `${defaultDir.replace(/\/$/, '')}/` : '');
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

  const handleCreate = useCallback(() => {
    const normalizedPath = normalizeNewFilePath(
      defaultDir && !pathInput.includes('/')
        ? `${defaultDir.replace(/\/$/, '')}/${pathInput}`
        : pathInput
    );

    const pathError = validateRelativeFilePath(normalizedPath);
    if (pathError) {
      setValidationError(pathError);
      return;
    }

    setValidationError(null);
    onCreated(normalizedPath);
    onOpenChange(false);
    void runBackgroundCreate(normalizedPath);
  }, [defaultDir, onCreated, onOpenChange, pathInput, runBackgroundCreate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none border-2 border-chatroom-border-strong bg-chatroom-bg-primary text-chatroom-text-primary sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-chatroom-text-primary">New File</DialogTitle>
          <DialogDescription className="text-chatroom-text-secondary">
            Enter a relative path. Press{' '}
            <kbd className="rounded border border-chatroom-border px-1">⌘S</kbd> to save. Files
            without an extension default to <code>.md</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            value={pathInput}
            onChange={(event) => {
              setPathInput(event.target.value);
              setValidationError(null);
            }}
            placeholder="docs/notes.md"
            className={cn(
              'bg-chatroom-bg-secondary border-chatroom-border text-chatroom-text-primary',
              validationError && 'border-chatroom-status-error'
            )}
            autoFocus
            // fallow-ignore-next-line complexity
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                handleCreate();
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                handleCreate();
              }
            }}
          />
          {validationError && (
            <p className="text-xs text-chatroom-status-error">{validationError}</p>
          )}
        </div>

        <DialogFooter className="border-t border-chatroom-border pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="bg-chatroom-bg-tertiary border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            className="bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-accent/90 border-0"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
