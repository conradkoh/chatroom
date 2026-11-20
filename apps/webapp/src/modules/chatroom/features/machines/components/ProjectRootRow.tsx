'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Loader2, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { getMachineErrorCopy } from '../lib/machineErrorCopy';

import type { MachineProjectRoot } from '@/hooks/useMachineProjectRoots';

export interface ProjectRootRowProps {
  root: MachineProjectRoot;
  /** Removing works offline and needs no confirmation. */
  onRemove: (rootId: Id<'chatroom_machineProjectRoots'>) => Promise<unknown>;
}

const REMOVE_FALLBACK_COPY = 'Could not remove the folder. Try again.';

/**
 * One root path with a ghost remove button and an inline retry error.
 *
 * A successful remove unmounts this row when the list subscription updates, so the
 * success path deliberately leaves `pending` set instead of touching unmounted state.
 */
export function ProjectRootRow({ root, onRemove }: ProjectRootRowProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = useCallback(async () => {
    setError(null);
    setPending(true);
    try {
      await onRemove(root.rootId);
      // removed:true and removed:false are both success; the row disappears with the query.
    } catch (err) {
      setPending(false);
      setError(getMachineErrorCopy(err, REMOVE_FALLBACK_COPY));
    }
  }, [onRemove, root.rootId]);

  return (
    <li
      data-testid="project-root-row"
      className="border border-chatroom-border bg-chatroom-bg-secondary px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          title={root.path}
          className="min-w-0 flex-1 truncate font-mono text-xs text-chatroom-text-primary"
        >
          {root.path}
        </span>
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          aria-label={`Remove project root ${root.path}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center text-chatroom-text-muted transition-colors hover:text-chatroom-status-error disabled:opacity-50 sm:h-8 sm:w-8"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-chatroom-status-error">
          {error}
        </p>
      )}
    </li>
  );
}
