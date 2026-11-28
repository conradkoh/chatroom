'use client';

import { FolderOpen } from 'lucide-react';
import { useRef, useState } from 'react';

import { isSameWorkspace } from './lib/switchWorkspaceCopy';
import { useFocusOnMount } from './useFocusOnMount';
import type { SwitchWorkspaceFlow, SwitchTarget } from './useSwitchWorkspaceFlow';

import { InlineFeedback } from '@/components/inline-feedback';
import { useConnectedMachines } from '@/hooks/useConnectedMachines';
import { useMachineCapabilities } from '@/hooks/useMachineCapabilities';
import { pickDefaultMachineId } from '@/modules/chatroom/components/setup/pickDefaultMachineId';
import { SetupFolderPickerField } from '@/modules/chatroom/components/setup/SetupFolderPickerField';
import { SetupMachineSection } from '@/modules/chatroom/components/setup/SetupMachineSection';
import {
  SetupStepFooter,
  SetupStepLayout,
  setupPrimaryButtonClassName,
  setupSecondaryButtonClassName,
} from '@/modules/chatroom/components/setup/SetupStepLayout';
import { SetupWorkspaceLoadingPanel } from '@/modules/chatroom/components/setup/SetupWorkspaceLoadingPanel';
import { useSetupWorkspaceFolderPicker } from '@/modules/chatroom/components/setup/useSetupWorkspaceFolderPicker';
import { useChatroomWorkspace } from '@/modules/chatroom/context/ChatroomWorkspaceContext';
import { getMachineDisplayName, type UserMachine } from '@/modules/chatroom/types/machine';
import { getWorkspaceDisplayHostname, type Workspace } from '@/modules/chatroom/types/workspace';

export function SwitchWorkspaceChooseStep({
  flow,
  onCancel,
}: {
  flow: SwitchWorkspaceFlow;
  onCancel?(): void;
}) {
  const { activeWorkspace } = useChatroomWorkspace();
  const { machines, connectedMachineIds, isLoading } = useConnectedMachines();
  if (isLoading) return <SetupWorkspaceLoadingPanel />;
  if (!activeWorkspace) return null;
  return (
    <ChooseForm
      flow={flow}
      onCancel={onCancel}
      machines={machines}
      connectedMachineIds={connectedMachineIds}
      current={activeWorkspace}
    />
  );
}

function initialMachineId(
  flow: SwitchWorkspaceFlow,
  current: Workspace,
  machines: UserMachine[],
  connectedMachineIds: ReadonlySet<string>
): string | null {
  if (flow.target) return flow.target.machineId;
  if (current.machineId && machines.some((m) => m.machineId === current.machineId)) {
    return current.machineId;
  }
  return pickDefaultMachineId(
    machines.filter((m) => connectedMachineIds.has(m.machineId)),
    null
  );
}

// fallow-ignore-next-line complexity
function ChooseForm({
  flow,
  onCancel,
  machines,
  connectedMachineIds,
  current,
}: {
  flow: SwitchWorkspaceFlow;
  onCancel?(): void;
  machines: UserMachine[];
  connectedMachineIds: ReadonlySet<string>;
  current: Workspace;
}) {
  const [chosenMachineId, setChosenMachineId] = useState<string | null>(() =>
    initialMachineId(flow, current, machines, connectedMachineIds)
  );
  const [path, setPath] = useState(flow.target?.workingDir ?? '');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnMount(headingRef);

  const selectedMachine = machines.find((m) => m.machineId === chosenMachineId) ?? null;
  const selectedOffline = chosenMachineId !== null && !connectedMachineIds.has(chosenMachineId);
  const { availableHarnesses } = useMachineCapabilities(chosenMachineId);
  const { picker, reset: resetFolderPicker } = useSetupWorkspaceFolderPicker({
    selectedMachineId: chosenMachineId,
    selectedMachine,
    onPathSelected: setPath,
  });

  const sameAsCurrent =
    chosenMachineId !== null &&
    isSameWorkspace(current, { machineId: chosenMachineId, workingDir: path });
  const canReview = chosenMachineId !== null && path.trim() !== '' && !sameAsCurrent;
  const currentLabel = getWorkspaceDisplayHostname(current);
  const folderName = current.workingDir.split('/').filter(Boolean).pop() ?? current.workingDir;

  const selectMachine = (machineId: string) => {
    setChosenMachineId(machineId);
    setPath('');
    flow.clearError();
    resetFolderPicker();
  };
  const changePath = (value: string) => {
    setPath(value);
    if (flow.error) flow.clearError();
  };
  const review = () => {
    if (!canReview || chosenMachineId === null) return;
    const target: SwitchTarget = {
      machineId: chosenMachineId,
      machineLabel: selectedMachine ? getMachineDisplayName(selectedMachine) : chosenMachineId,
      connected: !selectedOffline,
      workingDir: path.trim(),
    };
    flow.startReview(target);
  };

  return (
    <SetupStepLayout
      autoFocusFirstControl={false}
      footer={
        <SetupStepFooter
          secondary={
            onCancel ? (
              <button type="button" onClick={onCancel} className={setupSecondaryButtonClassName}>
                Cancel
              </button>
            ) : undefined
          }
          primary={
            <button
              type="button"
              disabled={!canReview}
              onClick={review}
              className={setupPrimaryButtonClassName}
            >
              Review switch
            </button>
          }
        />
      }
    >
      <h3 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
        Choose a target
      </h3>
      <section
        data-testid="switch-current-summary"
        className="space-y-1 border border-chatroom-border bg-chatroom-bg-surface p-3"
      >
        <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
          Current workspace
        </h3>
        <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-chatroom-text-primary">
          <FolderOpen size={14} className="shrink-0 text-chatroom-text-muted" />
          <span className="truncate">{folderName}</span>
          <span className="truncate text-xs font-normal text-chatroom-text-muted">
            {currentLabel}
          </span>
        </p>
        <p className="break-all font-mono text-xs text-chatroom-text-muted">{current.workingDir}</p>
      </section>
      <SetupMachineSection
        machines={machines}
        connectedMachineIds={connectedMachineIds}
        selectedMachineId={chosenMachineId}
        onSelectMachine={selectMachine}
        detectedHarnesses={availableHarnesses}
        offlineSelectable
      />
      {selectedOffline && selectedMachine && (
        <InlineFeedback
          data-testid="switch-offline-warning"
          feedback={{
            id: 1,
            tone: 'warning',
            message: `${getMachineDisplayName(selectedMachine)} is offline. The workspace is switched now; agents cannot start there until its daemon runs. Browse needs the daemon, so type the folder path.`,
          }}
        />
      )}
      <SetupFolderPickerField
        variant="setup"
        heading="Workspace Folder"
        inputAriaLabel="Workspace Folder"
        waitingText={`Waiting for folder selection on ${picker.machineDisplayName ?? 'machine'}...`}
        value={path}
        onChange={changePath}
        placeholder={
          selectedMachine
            ? `Select a folder on ${getMachineDisplayName(selectedMachine)}`
            : 'Select a machine first'
        }
        inputDisabled={chosenMachineId === null}
        browseDisabled={chosenMachineId === null || selectedOffline}
        picker={picker}
        invalid={flow.error?.kind === 'invalid-path'}
        stackOnMobile
        hint={
          sameAsCurrent ? (
            <p className="text-xs text-chatroom-text-muted">
              This is already the current workspace.
            </p>
          ) : flow.error?.kind === 'invalid-path' ? (
            <p className="text-xs text-chatroom-status-error">{flow.error.message}</p>
          ) : undefined
        }
      />
    </SetupStepLayout>
  );
}
