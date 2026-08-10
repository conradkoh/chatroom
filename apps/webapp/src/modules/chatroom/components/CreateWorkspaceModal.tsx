'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexError } from 'convex/values';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Loader2, Plus } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import { SetupFolderPickerField } from './setup/SetupFolderPickerField';
import { SetupMachinePicker } from './setup/SetupMachinePicker';
import { useSetupWorkspaceFolderPicker } from './setup/useSetupWorkspaceFolderPicker';
import type { MachineInfo } from '../types/machine';
import { getMachineDisplayName } from '../types/machine';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CreateWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Creates an unassigned (chatroom-free) workspace: pick a machine first, then
 * a path. The live `listAllWorkspaces` subscription updates the listing without
 * any manual refetch after a successful create.
 */
// fallow-ignore-next-line complexity
export const CreateWorkspaceModal = memo(function CreateWorkspaceModal({
  open,
  onOpenChange,
}: CreateWorkspaceModalProps) {
  const machinesResult = useSessionQuery(api.machines.listMachines);
  const machines = useMemo(
    () => (machinesResult?.machines ?? []) as MachineInfo[],
    [machinesResult]
  );

  const createWorkspace = useSessionMutation(api.workspaces.createWorkspace);

  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [pathError, setPathError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedMachine = useMemo(
    () => machines.find((m) => m.machineId === selectedMachineId) ?? null,
    [machines, selectedMachineId]
  );

  const {
    requestId,
    isPending,
    isTimedOut,
    handleBrowse,
    handleRetryAfterTimeout,
    reset: resetFolderPicker,
    machineDisplayName,
  } = useSetupWorkspaceFolderPicker({
    selectedMachineId,
    selectedMachine,
    onPathSelected: setSelectedPath,
    setError: setPathError,
  });

  const handleSelectMachine = useCallback(
    (machineId: string) => {
      setSelectedMachineId(machineId);
      setSelectedPath('');
      setPathError(null);
      resetFolderPicker();
    },
    [resetFolderPicker]
  );

  // Structured CONFLICT surfaces inline under the path field; other failures
  // fall through to a generic inline error.
  // fallow-ignore-next-line complexity
  const handleSubmit = useCallback(async () => {
    const path = selectedPath.trim();
    if (!selectedMachineId || !path) {
      setPathError('Select a machine and workspace folder');
      return;
    }
    setIsSubmitting(true);
    setPathError(null);
    try {
      await createWorkspace({ machineId: selectedMachineId, workingDir: path });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ConvexError && (err.data as { code?: string })?.code === 'CONFLICT') {
        setPathError(
          (err.data as { message?: string }).message ?? 'Workspace already exists on this machine'
        );
      } else {
        setPathError(err instanceof Error ? err.message : 'Failed to create workspace');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [createWorkspace, selectedMachineId, selectedPath, onOpenChange]);

  const canSubmit = Boolean(
    selectedMachineId && selectedPath.trim() && !isSubmitting && !isPending
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (canSubmit) void handleSubmit();
    },
    [canSubmit, handleSubmit]
  );

  const folderPlaceholder = selectedMachine
    ? `Select a folder on ${getMachineDisplayName(selectedMachine)}`
    : 'Select a machine first';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        <form onSubmit={handleFormSubmit}>
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
            <DialogDescription>
              Create an unassigned workspace on one of your machines.
            </DialogDescription>
          </DialogHeader>

          {machinesResult === undefined ? (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <ChatroomLoader size="md" />
              <span className="text-chatroom-text-muted text-sm">Loading machines...</span>
            </div>
          ) : machines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span className="text-chatroom-text-muted text-base mb-2">No machines connected</span>
              <p className="text-chatroom-text-muted text-sm max-w-md">
                Register a machine first so you can create a workspace on it.
              </p>
            </div>
          ) : (
            <div className="space-y-6 pt-4">
              <SetupMachinePicker
                machines={machines}
                selectedMachineId={selectedMachineId}
                onSelectMachine={handleSelectMachine}
              />

              <SetupFolderPickerField
                selectedPath={selectedPath}
                onPathChange={setSelectedPath}
                placeholder={folderPlaceholder}
                disabled={!selectedMachineId}
                isPending={isPending}
                isConfirming={isSubmitting}
                isTimedOut={isTimedOut}
                requestId={requestId}
                machineDisplayName={machineDisplayName}
                onBrowse={() => void handleBrowse()}
                onRetryAfterTimeout={handleRetryAfterTimeout}
              />

              {pathError && <p className="text-xs text-chatroom-status-error">{pathError}</p>}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-6">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-2 px-4 py-2 bg-chatroom-accent text-chatroom-bg-primary text-xs font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
});
