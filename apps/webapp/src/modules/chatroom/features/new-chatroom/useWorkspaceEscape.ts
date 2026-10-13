'use client';

import { useEffect, useState } from 'react';

import type { CloneLeaveGuard } from './CloneLeaveDialog';
import type { GitCloneViewState } from './lib/deriveGitCloneViewState';

/** Clone states where leaving would leave unsaved work behind. Every other state cancels at once. */
const LEAVE_GUARD_BY_KIND: Partial<Record<GitCloneViewState['kind'], CloneLeaveGuard>> = {
  waiting: 'running',
  cloning: 'running',
  stalled: 'running',
  completed: 'completed',
};

type EscapeAction =
  { kind: 'none' } | { kind: 'cancel' } | { kind: 'confirm'; guard: CloneLeaveGuard };

/** What Escape does on the workspace step. A chatroom create in flight is never interrupted. */
function escapeAction(guard: CloneLeaveGuard | null, isCreating: boolean): EscapeAction {
  if (isCreating) return { kind: 'none' };
  return guard === null ? { kind: 'cancel' } : { kind: 'confirm', guard };
}

/**
 * Escape on the workspace step. It cancels at once, unless a clone is unsaved, in which case it
 * opens the confirm first. `dialogGuard` is set while the confirm is open. The Escape listener is
 * removed while it is open, so the dialog's own Escape handling closes it and nothing reopens it.
 */
export function useWorkspaceEscape({
  viewState,
  isCreating,
  onCancel,
}: {
  viewState: GitCloneViewState;
  isCreating: boolean;
  onCancel: () => void;
}) {
  const [dialogGuard, setDialogGuard] = useState<CloneLeaveGuard | null>(null);
  const guard = LEAVE_GUARD_BY_KIND[viewState.kind] ?? null;

  useEffect(() => {
    if (dialogGuard !== null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const action = escapeAction(guard, isCreating);
      if (action.kind === 'cancel') onCancel();
      else if (action.kind === 'confirm') setDialogGuard(action.guard);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dialogGuard, guard, isCreating, onCancel]);

  return { dialogGuard, closeDialog: () => setDialogGuard(null) };
}
