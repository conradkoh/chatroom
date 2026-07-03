'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

import { FILE_EXPLORER_REFRESH_EVENT } from './fileExplorerEvents';
import { pollFileWriteRequest } from '../hooks/useWorkspaceFileSave';
import { compressGzip, normalizeNewFilePath, validateRelativeFilePath } from '../utils/gzipContent';

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

const DEFAULT_NEW_FILE_CONTENT = '# New file\n';

interface NewFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machineId: string;
  workingDir: string;
  defaultDir?: string;
  onCreated: (filePath: string) => void;
}

// fallow-ignore-next-line complexity
export function NewFileDialog({
  open,
  onOpenChange,
  machineId,
  workingDir,
  defaultDir,
  onCreated,
}: NewFileDialogProps) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);

  const [pathInput, setPathInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPathInput(defaultDir ? `${defaultDir.replace(/\/$/, '')}/` : '');
    setValidationError(null);
    setSubmitError(null);
    setCreating(false);
  }, [defaultDir, open]);

  const handleCreate = useCallback(
    // fallow-ignore-next-line complexity
    async () => {
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
      setSubmitError(null);
      setCreating(true);

      try {
        const data = await compressGzip(DEFAULT_NEW_FILE_CONTENT);
        const result = await requestFileWrite({
          machineId,
          workingDir,
          filePath: normalizedPath,
          operation: 'create',
          data,
        });

        await pollFileWriteRequest(async (requestId) => {
          if (!sessionId) {
            throw new Error('Authentication required');
          }
          return convex.query(api.workspaceFiles.getFileWriteRequest, {
            sessionId,
            requestId,
          });
        }, result.requestId);

        window.dispatchEvent(new CustomEvent(FILE_EXPLORER_REFRESH_EVENT));
        onCreated(normalizedPath);
        onOpenChange(false);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to create file');
      } finally {
        setCreating(false);
      }
    },
    [
      convex,
      defaultDir,
      machineId,
      onCreated,
      onOpenChange,
      pathInput,
      requestFileWrite,
      sessionId,
      workingDir,
    ]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-chatroom-bg-primary border-chatroom-border text-chatroom-text-primary sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New File</DialogTitle>
          <DialogDescription className="text-chatroom-text-muted">
            Enter a relative path. Files without an extension default to <code>.md</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            value={pathInput}
            onChange={(event) => {
              setPathInput(event.target.value);
              setValidationError(null);
              setSubmitError(null);
            }}
            placeholder="docs/notes.md"
            className={cn(
              'bg-chatroom-bg-secondary border-chatroom-border text-chatroom-text-primary',
              validationError && 'border-chatroom-status-error'
            )}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleCreate();
              }
            }}
          />
          {validationError && (
            <p className="text-xs text-chatroom-status-error">{validationError}</p>
          )}
          {submitError && <p className="text-xs text-chatroom-status-error">{submitError}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={creating}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
