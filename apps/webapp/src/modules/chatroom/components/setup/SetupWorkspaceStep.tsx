'use client';

import { FolderOpen, Loader2, Monitor } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { SetupPrerequisiteRow } from './SetupPrerequisiteRow';
import type { MachineInfo } from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';

import { useFolderPicker } from '@/hooks/useFolderPicker';
import { getAuthLoginCommand, getDaemonStartCommand } from '@/lib/environment';

interface SetupWorkspaceStepProps {
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  onConfirm: (machineId: string, workingDir: string) => Promise<void>;
}

const HARNESS_INSTALL_COMMAND =
  '# Install a supported harness:\nnpm install -g opencode-ai   # opencode\nnpm install -g @plandex/pi   # pi';

// fallow-ignore-next-line complexity
export const SetupWorkspaceStep = memo(function SetupWorkspaceStep({
  connectedMachines,
  isLoadingMachines,
  onConfirm,
}: SetupWorkspaceStepProps) {
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pickFolder, request, requestId, reset, isPending, isTimedOut } = useFolderPicker();

  const daemonStartCommand = getDaemonStartCommand();
  const authLoginCommand = getAuthLoginCommand(
    typeof window !== 'undefined' ? window.location.origin : ''
  );

  const detectedHarnesses = useMemo(() => {
    const all = connectedMachines.flatMap((m) => m.availableHarnesses);
    return [...new Set(all)];
  }, [connectedMachines]);

  const harnessDone = detectedHarnesses.length > 0;
  const daemonDone = connectedMachines.length > 0;

  useEffect(() => {
    if (connectedMachines.length === 1 && !selectedMachineId) {
      setSelectedMachineId(connectedMachines[0].machineId);
    }
  }, [connectedMachines, selectedMachineId]);

  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!request || request.status === 'pending') return;
    if (request.status === 'completed' && request.selectedPath) {
      setSelectedPath(request.selectedPath);
      setError(null);
      reset();
      return;
    }
    if (request.status === 'cancelled') {
      setError(null);
      reset();
      return;
    }
    if (request.status === 'failed') {
      setError(request.errorMessage ?? 'Folder picker failed');
      reset();
    }
  }, [request, reset]);

  useEffect(() => {
    if (isTimedOut) {
      setError('Folder picker timed out. Ensure the daemon is running on the selected machine.');
    }
  }, [isTimedOut]);

  const selectedMachine = useMemo(
    () => connectedMachines.find((m) => m.machineId === selectedMachineId) ?? null,
    [connectedMachines, selectedMachineId]
  );

  const handleBrowse = useCallback(async () => {
    if (!selectedMachineId) {
      setError('Select a machine first');
      return;
    }
    setError(null);
    try {
      await pickFolder(selectedMachineId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open folder picker');
    }
  }, [pickFolder, selectedMachineId]);

  // fallow-ignore-next-line complexity
  const handleConfirm = useCallback(async () => {
    const path = selectedPath.trim();
    if (!selectedMachineId || !path) {
      setError('Select a machine and workspace folder');
      return;
    }
    setIsConfirming(true);
    setError(null);
    try {
      await onConfirm(selectedMachineId, path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setIsConfirming(false);
    }
  }, [onConfirm, selectedMachineId, selectedPath]);

  if (isLoadingMachines) {
    return (
      <div className="flex items-center justify-center py-12 text-chatroom-text-muted">
        <Loader2 size={18} className="animate-spin mr-2" />
        <span className="text-sm">Loading machines...</span>
      </div>
    );
  }

  if (connectedMachines.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
          Prerequisites
        </h3>
        <div className="flex flex-col gap-2">
          <SetupPrerequisiteRow done={false} label="Auth login" command={authLoginCommand} />
          <SetupPrerequisiteRow
            done={false}
            label="Daemon connected"
            command={daemonStartCommand}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
          Prerequisites
        </h3>
        <div className="flex flex-col gap-2">
          <SetupPrerequisiteRow
            done={daemonDone}
            label="Daemon connected"
            doneDetail="Machine online"
          />
          <SetupPrerequisiteRow
            done={harnessDone}
            label="Harness installed"
            command={harnessDone ? undefined : HARNESS_INSTALL_COMMAND}
            doneDetail={harnessDone ? detectedHarnesses.join(', ') : undefined}
          />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
          Machine
        </h3>
        <div className="flex flex-col gap-2">
          {connectedMachines.map((machine) => (
            <button
              key={machine.machineId}
              type="button"
              onClick={() => {
                setSelectedMachineId(machine.machineId);
                setSelectedPath('');
                setError(null);
                reset();
              }}
              className={`flex items-center gap-3 p-3 border text-left transition-colors ${
                selectedMachineId === machine.machineId
                  ? 'border-chatroom-accent bg-chatroom-bg-surface'
                  : 'border-chatroom-border hover:border-chatroom-border-strong'
              }`}
            >
              <Monitor size={16} className="text-chatroom-text-muted flex-shrink-0" />
              <span className="text-sm font-medium text-chatroom-text-primary">
                {getMachineDisplayName(machine)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
          Workspace Folder
        </h3>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={selectedPath}
              onChange={(e) => setSelectedPath(e.target.value)}
              placeholder={
                selectedMachine
                  ? `Select a folder on ${getMachineDisplayName(selectedMachine)}`
                  : 'Select a machine first'
              }
              disabled={!selectedMachineId || isPending}
              className="flex-1 bg-chatroom-bg-tertiary border border-chatroom-border text-sm font-mono text-chatroom-text-primary px-3 py-2 focus:outline-none focus:border-chatroom-accent disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleBrowse()}
              disabled={!selectedMachineId || isPending || isConfirming}
              className="flex items-center gap-2 px-3 py-2 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FolderOpen size={14} />
              )}
              Browse
            </button>
          </div>
          {requestId && isPending && (
            <p className="text-xs text-chatroom-text-muted">
              Waiting for folder selection on{' '}
              {selectedMachine ? getMachineDisplayName(selectedMachine) : 'machine'}...
            </p>
          )}
          {isTimedOut && (
            <button
              type="button"
              onClick={() => {
                reset();
                setError(null);
              }}
              className="text-xs text-chatroom-accent hover:text-chatroom-text-primary text-left"
            >
              Folder picker timed out — click to try again
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-chatroom-status-error">{error}</p>}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={!selectedMachineId || !selectedPath.trim() || isConfirming || isPending}
          className="px-4 py-2 bg-chatroom-accent text-chatroom-bg-primary text-xs font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
        >
          {isConfirming ? 'Creating...' : 'Confirm Workspace'}
        </button>
      </div>
    </div>
  );
});
