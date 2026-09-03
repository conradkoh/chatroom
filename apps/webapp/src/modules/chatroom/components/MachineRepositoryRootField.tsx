'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { FolderOpen, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useFolderPicker } from '@/hooks/useFolderPicker';

type FolderPickerRequest = NonNullable<ReturnType<typeof useFolderPicker>['request']>;

interface MachineRepositoryRootFieldProps {
  machineId: string;
  daemonConnected: boolean;
  repositoryRoot?: string;
  isLoading?: boolean;
}

/** Maps all terminal picker states to user feedback. */
// fallow-ignore-next-line complexity
function getPickerResult(request: FolderPickerRequest): {
  selectedPath?: string;
  error: string | null;
} {
  if (request.status === 'completed' && request.selectedPath) {
    return { selectedPath: request.selectedPath, error: null };
  }
  if (request.status === 'cancelled') return { error: null };
  if (request.status === 'failed') {
    return { error: request.errorMessage ?? 'Folder picker failed' };
  }
  return { error: 'Folder picker returned no folder' };
}

/** Renders the browse and conditional clear actions. */
// fallow-ignore-next-line complexity
function RepositoryRootActions({
  daemonConnected,
  isBusy,
  isLoading,
  repositoryRoot,
  onBrowse,
  onClear,
}: {
  daemonConnected: boolean;
  isBusy: boolean;
  isLoading: boolean;
  repositoryRoot?: string;
  onBrowse: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBrowse}
        disabled={!daemonConnected || isBusy || isLoading}
        title={
          daemonConnected
            ? 'Browse for repository root'
            : 'Connect daemon on this machine to browse folders'
        }
        className="inline-flex flex-shrink-0 items-center gap-1 border border-chatroom-border px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted transition-colors hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FolderOpen size={12} />
        Browse
      </button>
      {repositoryRoot ? (
        <button
          type="button"
          onClick={onClear}
          disabled={isBusy || isLoading}
          title="Clear repository root"
          aria-label="Clear repository root"
          className="inline-flex flex-shrink-0 items-center border border-chatroom-border p-1 text-chatroom-text-muted transition-colors hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X size={12} />
        </button>
      ) : null}
    </>
  );
}

function RepositoryRootFeedback({
  daemonConnected,
  error,
}: {
  daemonConnected: boolean;
  error: string | null;
}) {
  return (
    <>
      {!daemonConnected ? (
        <p className="text-[10px] text-chatroom-text-muted">
          Connect daemon on this machine to browse folders.
        </p>
      ) : null}
      {error ? <p className="text-[10px] text-chatroom-status-error">{error}</p> : null}
    </>
  );
}

/**
 * Edits the per-user repository root used for future repository clones.
 * Folder selection is delegated to the existing daemon-backed picker flow.
 */
/** Coordinates picker, persistence, and explicit UI states. */
// fallow-ignore-next-line complexity
export function MachineRepositoryRootField({
  machineId,
  daemonConnected,
  repositoryRoot,
  isLoading = false,
}: MachineRepositoryRootFieldProps) {
  const setMachineRepositoryRoot = useSessionMutation(api.machines.setMachineRepositoryRoot);
  const { pickFolder, request, reset, isPending, isTimedOut } = useFolderPicker();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveRepositoryRoot = useCallback(
    async (nextRoot: string | undefined) => {
      setError(null);
      setIsSaving(true);
      try {
        await setMachineRepositoryRoot({
          machineId,
          repositoryRoot: nextRoot,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save repository root');
      } finally {
        setIsSaving(false);
      }
    },
    [machineId, setMachineRepositoryRoot]
  );

  useEffect(() => {
    if (!request || request.status === 'pending') return;
    const result = getPickerResult(request);
    if (result.selectedPath) void saveRepositoryRoot(result.selectedPath);
    setError(result.error);
    reset();
  }, [request, reset, saveRepositoryRoot]);

  useEffect(() => {
    if (isTimedOut) {
      setError('Folder picker timed out. Ensure the daemon is running on this machine.');
    }
  }, [isTimedOut]);

  const handleBrowse = useCallback(async () => {
    setError(null);
    try {
      await pickFolder(machineId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open folder picker');
    }
  }, [machineId, pickFolder]);

  const isBusy = isPending || isSaving;

  return (
    <div className="mt-2 space-y-1.5 border-t border-chatroom-border pt-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Repository root
        </label>
        {isBusy ? (
          <Loader2 className="h-3 w-3 animate-spin text-chatroom-text-muted" aria-label="Saving" />
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <code
          className={`min-w-0 flex-1 truncate border border-chatroom-border bg-chatroom-bg-tertiary px-2 py-1 text-[10px] font-mono ${repositoryRoot ? 'text-chatroom-text-secondary' : 'text-chatroom-text-muted'}`}
          title={repositoryRoot}
        >
          {isLoading ? 'Loading…' : repositoryRoot || 'Not configured'}
        </code>
        <RepositoryRootActions
          daemonConnected={daemonConnected}
          isBusy={isBusy}
          isLoading={isLoading}
          repositoryRoot={repositoryRoot}
          onBrowse={handleBrowse}
          onClear={() => void saveRepositoryRoot(undefined)}
        />
      </div>
      <RepositoryRootFeedback daemonConnected={daemonConnected} error={error} />
    </div>
  );
}
