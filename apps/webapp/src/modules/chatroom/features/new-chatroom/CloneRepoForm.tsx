'use client';

import { validateGitCloneUrl } from '@workspace/shared/domain/git-clone';
import { useEffect, useRef, type FormEvent } from 'react';

import { CloneFields } from './CloneFields';
import { CloneStatusPanel } from './CloneStatusPanel';
import type { GitCloneViewState } from './lib/deriveGitCloneViewState';
import { useCloneTarget } from './useCloneTarget';
import { useFocusFirstControl } from './useFocusFirstControl';
import type { UseGitCloneRequestResult } from './useGitCloneRequest';
import type { UserMachine } from '../../types/machine';

interface CloneRepoFormProps {
  machine: UserMachine;
  isMachineConnected: boolean;
  /** The clone request state. The workspace step owns it so a tab switch cannot lose it. */
  clone: UseGitCloneRequestResult;
  /** Called exactly once per completed clone, with the cloned path. */
  onWorkspaceReady: (workingDir: string) => void;
  onBack: () => void;
}

/** A clone can start only from idle, with a valid URL and absolute target on a connected machine. */
function canStartClone(args: {
  state: GitCloneViewState;
  repoUrl: string;
  cloneTo: string;
  isMachineConnected: boolean;
}): boolean {
  return (
    args.state.kind === 'idle' &&
    validateGitCloneUrl(args.repoUrl).ok &&
    args.cloneTo.trim().startsWith('/') &&
    args.isMachineConnected
  );
}

/** Waiting or running. The fields and Back are locked then. */
function isLocked(state: GitCloneViewState): boolean {
  return state.kind === 'waiting' || state.kind === 'cloning';
}

/** The cloned path, once this request has completed. */
function completedPathOf(state: GitCloneViewState, requestId: string | null): string | null {
  return state.kind === 'completed' && requestId !== null ? state.clonedPath : null;
}

/** Hands the cloned path to the wizard once per request, however many times the view re-renders. */
function useCloneCompletionHandoff(
  state: GitCloneViewState,
  requestId: string | null,
  onWorkspaceReady: (workingDir: string) => void
): void {
  const notifiedForRef = useRef<string | null>(null);
  const path = completedPathOf(state, requestId);
  useEffect(() => {
    if (path === null || notifiedForRef.current === requestId) return;
    notifiedForRef.current = requestId;
    onWorkspaceReady(path);
  }, [path, requestId, onWorkspaceReady]);
}

/**
 * Clone a git repository onto the selected machine. It starts a daemon request and follows its
 * status. It never creates the chatroom itself. Completion hands the cloned path to the wizard.
 */
export function CloneRepoForm({
  machine,
  isMachineConnected,
  clone,
  onWorkspaceReady,
  onBack,
}: CloneRepoFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusFirstControl(containerRef);

  const target = useCloneTarget(machine);
  const viewState = clone.viewState;
  const locked = isLocked(viewState);
  const canClone = canStartClone({
    state: viewState,
    repoUrl: target.repoUrl,
    cloneTo: target.cloneTo,
    isMachineConnected,
  });
  useCloneCompletionHandoff(viewState, clone.requestId, onWorkspaceReady);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canClone) void clone.start(machine.machineId, target.repoUrl.trim(), target.cloneTo.trim());
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-4 min-h-[18rem]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <CloneFields
          repoUrl={target.repoUrl}
          cloneTo={target.cloneTo}
          locked={locked}
          browseDisabled={!isMachineConnected || locked}
          isPickingParent={target.folderPicker.isPending}
          isPickerTimedOut={target.folderPicker.isTimedOut}
          pickerError={target.pickerError}
          machineName={machine.hostname}
          onRepoUrlChange={target.handleRepoUrlChange}
          onCloneToChange={target.handleCloneToChange}
          onBrowse={() => void target.folderPicker.handleBrowse()}
          onRetryBrowse={target.folderPicker.handleRetryAfterTimeout}
        />

        <CloneStatusPanel state={viewState} machineName={machine.hostname} onRetry={clone.reset} />

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={locked}
            className="px-4 py-2 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={!canClone}
            className="px-4 py-2 bg-chatroom-status-success text-chatroom-bg-primary text-xs font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
          >
            Clone
          </button>
        </div>
      </form>
    </div>
  );
}
