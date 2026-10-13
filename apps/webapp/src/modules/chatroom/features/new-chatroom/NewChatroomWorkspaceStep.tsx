'use client';

import { useState, type ReactNode } from 'react';

import { CloneLeaveDialog, type CloneLeaveGuard } from './CloneLeaveDialog';
import { CloneRepoForm } from './CloneRepoForm';
import { ExistingFolderForm } from './ExistingFolderForm';
import { useGitCloneRequest } from './hooks/useGitCloneRequest';
import { useWorkspaceEscape } from './hooks/useWorkspaceEscape';
import type { GitCloneViewState } from './lib/deriveGitCloneViewState';
import type { UserMachine } from '../../types/machine';

type WorkspaceSource = 'clone' | 'existing';

interface NewChatroomWorkspaceStepProps {
  machine: UserMachine;
  isMachineConnected: boolean;
  isCreating: boolean;
  /** Shown above the actions. The user stays on this step when creation fails. */
  createError: string | null;
  onBack: () => void;
  /** Escape cancels the wizard here, unless a clone is unsaved and the user confirms first. */
  onCancel: () => void;
  onWorkspaceReady: (workingDir: string) => void;
}

/** A clone that is started and has not yet failed, timed out, or been reset. Switching tabs is blocked. */
function isCloneInFlight(state: GitCloneViewState): boolean {
  return !['idle', 'failed', 'timed_out'].includes(state.kind);
}

function SourceTab({
  selected,
  disabled,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-10 flex-1 items-center justify-center px-2 py-2 text-center text-xs font-bold uppercase leading-tight tracking-wider border-chatroom-border disabled:opacity-50 sm:px-4 ${
        selected
          ? 'bg-chatroom-bg-hover text-chatroom-text-primary'
          : 'text-chatroom-text-muted hover:text-chatroom-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function SourceTabs({
  source,
  cloneInFlight,
  onSelect,
}: {
  source: WorkspaceSource;
  cloneInFlight: boolean;
  onSelect: (source: WorkspaceSource) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Workspace source"
      className="flex border-2 border-chatroom-border"
    >
      <SourceTab selected={source === 'clone'} disabled={false} onSelect={() => onSelect('clone')}>
        Git repository
      </SourceTab>
      <SourceTab
        selected={source === 'existing'}
        disabled={cloneInFlight}
        onSelect={() => onSelect('existing')}
      >
        Existing folder
      </SourceTab>
    </div>
  );
}

/**
 * The generic create error. A completed clone shows its own error next to its retry instead, so
 * the message appears once.
 */
function showsTopCreateError(createError: string | null, state: GitCloneViewState): boolean {
  return createError !== null && state.kind !== 'completed';
}

/** Class for a tab panel. The active panel fills the step; the inactive one is hidden. */
function panelClassName(active: boolean): string {
  return active ? 'flex min-h-0 flex-1 flex-col' : 'hidden';
}

/** The confirm for leaving an unsaved clone. Rendered only while it is open. */
function LeaveCloneConfirm({
  dialogGuard,
  hostname,
  onKeep,
  onLeave,
}: {
  dialogGuard: CloneLeaveGuard | null;
  hostname: string;
  onKeep: () => void;
  onLeave: () => void;
}) {
  if (dialogGuard === null) return null;
  return (
    <CloneLeaveDialog guard={dialogGuard} hostname={hostname} onKeep={onKeep} onLeave={onLeave} />
  );
}

/**
 * Step 2: choose the chatroom's folder. Either clone a git repository onto the machine, or use a
 * folder that already exists. Both forms stay mounted so typed inputs survive a tab switch.
 */
export function NewChatroomWorkspaceStep({
  machine,
  isMachineConnected,
  isCreating,
  createError,
  onBack,
  onCancel,
  onWorkspaceReady,
}: NewChatroomWorkspaceStepProps) {
  const [source, setSource] = useState<WorkspaceSource>('clone');
  const clone = useGitCloneRequest({ isMachineConnected });
  const escape = useWorkspaceEscape({ viewState: clone.viewState, isCreating, onCancel });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
        {!isMachineConnected && (
          <p
            role="status"
            className="border border-chatroom-status-warning p-3 text-xs text-chatroom-text-secondary"
          >
            {machine.hostname} is offline. Browse and Clone are unavailable until the daemon
            reconnects.
          </p>
        )}

        {showsTopCreateError(createError, clone.viewState) && (
          <p role="alert" className="text-xs text-chatroom-status-error">
            {createError}
          </p>
        )}

        <SourceTabs
          source={source}
          cloneInFlight={isCloneInFlight(clone.viewState)}
          onSelect={setSource}
        />
      </div>

      <div
        role="tabpanel"
        hidden={source !== 'clone'}
        className={panelClassName(source === 'clone')}
      >
        <CloneRepoForm
          machine={machine}
          isMachineConnected={isMachineConnected}
          isCreating={isCreating}
          createError={createError}
          clone={clone}
          onWorkspaceReady={onWorkspaceReady}
          onBack={onBack}
        />
      </div>

      <div
        role="tabpanel"
        hidden={source !== 'existing'}
        className={panelClassName(source === 'existing')}
      >
        <ExistingFolderForm
          machine={machine}
          isMachineConnected={isMachineConnected}
          isCreating={isCreating}
          onSubmit={onWorkspaceReady}
          onBack={onBack}
        />
      </div>

      <LeaveCloneConfirm
        dialogGuard={escape.dialogGuard}
        hostname={machine.hostname}
        onKeep={escape.closeDialog}
        onLeave={onCancel}
      />
    </div>
  );
}
