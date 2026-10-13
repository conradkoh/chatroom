'use client';

import { useCallback, useId, useState, type FormEvent } from 'react';

import { SetupFolderPickerField } from '../../components/setup/SetupFolderPickerField';
import {
  SetupStepFooter,
  SetupStepLayout,
  setupPrimaryButtonClassName,
  setupSecondaryButtonClassName,
} from '../../components/setup/SetupStepLayout';
import { useSetupWorkspaceFolderPicker } from '../../components/setup/useSetupWorkspaceFolderPicker';
import type { UserMachine } from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';

interface ExistingFolderFormProps {
  machine: UserMachine;
  isMachineConnected: boolean;
  isCreating: boolean;
  /** Receives the trimmed absolute path. The wizard decides whether to create the chatroom. */
  onSubmit: (workingDir: string) => void;
  onBack: () => void;
}

/** Back and the submit that creates the chatroom. The submit reaches the form by id. */
function FolderFormFooter({
  formId,
  canCreate,
  isCreating,
  onBack,
}: {
  formId: string;
  canCreate: boolean;
  isCreating: boolean;
  onBack: () => void;
}) {
  return (
    <SetupStepFooter
      secondary={
        <button
          type="button"
          onClick={onBack}
          disabled={isCreating}
          className={setupSecondaryButtonClassName}
        >
          Back
        </button>
      }
      primary={
        <button
          type="submit"
          form={formId}
          disabled={!canCreate}
          className={setupPrimaryButtonClassName}
        >
          {isCreating ? 'Creating…' : 'Create chatroom'}
        </button>
      }
    />
  );
}

/**
 * Existing-folder step. Takes a folder path, typed or browsed, and reports it. The step does not
 * list folders. Creating the chatroom is the wizard's job, so this form only reports the path.
 */
export function ExistingFolderForm({
  machine,
  isMachineConnected,
  isCreating,
  onSubmit,
  onBack,
}: ExistingFolderFormProps) {
  const formId = useId();

  const [selectedPath, setSelectedPath] = useState('');

  const { picker } = useSetupWorkspaceFolderPicker({
    selectedMachineId: machine.machineId,
    selectedMachine: machine,
    onPathSelected: setSelectedPath,
  });

  const trimmedPath = selectedPath.trim();
  const canCreate = trimmedPath.startsWith('/') && !isCreating;
  const machineName = getMachineDisplayName(machine);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (canCreate) onSubmit(trimmedPath);
    },
    [canCreate, onSubmit, trimmedPath]
  );

  return (
    <SetupStepLayout
      autoFocusFirstControl={true}
      footer={
        <FolderFormFooter
          formId={formId}
          canCreate={canCreate}
          isCreating={isCreating}
          onBack={onBack}
        />
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <SetupFolderPickerField
          variant="setup"
          heading="Workspace Folder"
          inputAriaLabel="Folder path"
          waitingText={`Waiting for folder selection on ${picker.machineDisplayName ?? 'machine'}...`}
          value={selectedPath}
          onChange={setSelectedPath}
          placeholder={`Type or browse a folder on ${machineName}`}
          inputDisabled={picker.isPending}
          browseDisabled={!isMachineConnected || isCreating}
          picker={picker}
        />
      </form>
    </SetupStepLayout>
  );
}
