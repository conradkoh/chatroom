'use client';

import { validateGitCloneUrl } from '@workspace/shared/domain/git-clone';
import { useEffect, useId, useRef, type FormEvent } from 'react';

import { CloneFields } from './CloneFields';
import { CloneStatusPanel } from './CloneStatusPanel';
import type { GitCloneViewState } from './lib/deriveGitCloneViewState';
import { useCloneTarget } from './useCloneTarget';
import type { UseGitCloneRequestResult } from './useGitCloneRequest';
import {
  SetupStepFooter,
  SetupStepLayout,
  setupPrimaryButtonClassName,
  setupSecondaryButtonClassName,
} from '../../components/setup/SetupStepLayout';
import type { UserMachine } from '../../types/machine';

interface CloneRepoFormProps {
  machine: UserMachine;
  isMachineConnected: boolean;
  /** The wizard is creating the chatroom. Disables the retry while it runs. */
  isCreating: boolean;
  /** The wizard's last create error. Shown here only once the clone has completed. */
  createError: string | null;
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

/** Shown when a completed clone's chatroom could not be created. Hidden in every other case. */
function CreateRetryAlert({
  clonedPath,
  createError,
}: {
  clonedPath: string | null;
  createError: string | null;
}) {
  if (clonedPath === null || createError === null) return null;
  return (
    <p role="alert" className="text-xs text-chatroom-status-error">
      Cloned to {clonedPath}, but the chatroom could not be created: {createError}. The clone is
      kept — select Create chatroom to try again.
    </p>
  );
}

/** Retry for a completed clone. It reuses the single creation path through onWorkspaceReady. */
function CreateChatroomButton({
  clonedPath,
  isCreating,
  onCreate,
}: {
  clonedPath: string;
  isCreating: boolean;
  onCreate: (workingDir: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCreate(clonedPath)}
      disabled={isCreating}
      className={setupPrimaryButtonClassName}
    >
      {isCreating ? 'Creating…' : 'Create chatroom'}
    </button>
  );
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
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-pass-data-to-parent -- completion arrives from the server subscription, not a user event, so this effect is the only point that can hand the path over.
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
  isCreating,
  createError,
  clone,
  onWorkspaceReady,
  onBack,
}: CloneRepoFormProps) {
  const formId = useId();

  const target = useCloneTarget(machine);
  const viewState = clone.viewState;
  const locked = isLocked(viewState);
  const canClone = canStartClone({
    state: viewState,
    repoUrl: target.repoUrl,
    cloneTo: target.cloneTo,
    isMachineConnected,
  });
  const completedPath = completedPathOf(viewState, clone.requestId);
  useCloneCompletionHandoff(viewState, clone.requestId, onWorkspaceReady);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canClone) void clone.start(machine.machineId, target.repoUrl.trim(), target.cloneTo.trim());
  };

  return (
    <SetupStepLayout
      autoFocusFirstControl={true}
      footer={
        <SetupStepFooter
          secondary={
            <button
              type="button"
              onClick={onBack}
              disabled={locked}
              className={setupSecondaryButtonClassName}
            >
              Back
            </button>
          }
          primary={
            completedPath === null ? (
              <button
                type="submit"
                form={formId}
                disabled={!canClone}
                className={setupPrimaryButtonClassName}
              >
                Clone
              </button>
            ) : (
              <CreateChatroomButton
                clonedPath={completedPath}
                isCreating={isCreating}
                onCreate={onWorkspaceReady}
              />
            )
          }
        />
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
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

        <CreateRetryAlert clonedPath={completedPath} createError={createError} />
      </form>
    </SetupStepLayout>
  );
}
