'use client';

import { ExistingFolderForm } from './ExistingFolderForm';
import type { UserMachine } from '../../types/machine';

interface NewChatroomWorkspaceStepProps {
  machine: UserMachine;
  isMachineConnected: boolean;
  isCreating: boolean;
  /** Shown above the actions. The user stays on this step when creation fails. */
  createError: string | null;
  onBack: () => void;
  onWorkspaceReady: (workingDir: string) => void;
}

/** Step 2: choose the chatroom's folder on the selected machine. */
export function NewChatroomWorkspaceStep({
  machine,
  isMachineConnected,
  isCreating,
  createError,
  onBack,
  onWorkspaceReady,
}: NewChatroomWorkspaceStepProps) {
  return (
    <div className="flex flex-col gap-4">
      {!isMachineConnected && (
        <p
          role="status"
          className="border border-chatroom-status-warning p-3 text-xs text-chatroom-text-secondary"
        >
          {machine.hostname} is offline. Browse is unavailable until the daemon reconnects.
        </p>
      )}

      {createError && (
        <p role="alert" className="text-xs text-chatroom-status-error">
          {createError}
        </p>
      )}

      <ExistingFolderForm
        machine={machine}
        isMachineConnected={isMachineConnected}
        isCreating={isCreating}
        onSubmit={onWorkspaceReady}
        onBack={onBack}
      />
    </div>
  );
}
