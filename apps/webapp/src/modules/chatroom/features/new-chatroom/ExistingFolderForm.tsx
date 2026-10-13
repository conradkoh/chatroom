'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useId, useMemo, useState, type FormEvent } from 'react';

import {
  PickerOptionRow,
  PickerScrollBody,
  PickerSearch,
  filterPickerItems,
} from '../../components/picker';
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

function FolderListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3" role="status" aria-label="Loading folders">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-7 bg-chatroom-bg-tertiary animate-pulse" />
      ))}
    </div>
  );
}

function EmptyFolderMessage({ message }: { message: string }) {
  return <p className="px-3 py-3 text-xs text-chatroom-text-muted">{message}</p>;
}

/** Folder rows, or the loading, empty, and no-match states. */
function FolderListBody({
  folders,
  visibleFolders,
  search,
  trimmedPath,
  onSelect,
}: {
  folders: string[] | undefined;
  visibleFolders: string[];
  search: string;
  trimmedPath: string;
  onSelect: (folder: string) => void;
}) {
  if (folders === undefined) return <FolderListSkeleton />;
  if (folders.length === 0) {
    return (
      <EmptyFolderMessage message="No folders registered on this machine yet. Browse or type a path." />
    );
  }
  if (visibleFolders.length === 0) {
    return <EmptyFolderMessage message={`No folders match “${search}”.`} />;
  }
  return (
    <>
      {visibleFolders.map((folder) => (
        <PickerOptionRow
          key={folder}
          selected={trimmedPath === folder}
          onSelect={() => onSelect(folder)}
        >
          <span className="font-mono truncate">{folder}</span>
        </PickerOptionRow>
      ))}
    </>
  );
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
 * Existing-folder step. Lists folders already registered on the machine, or takes a typed or
 * browsed path. Creating the chatroom is the wizard's job, so this form only reports the path.
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
  const [search, setSearch] = useState('');

  const folders = useSessionQuery(api.workspaces.listRegisteredWorkingDirsForMachine, {
    machineId: machine.machineId,
  });
  const visibleFolders = useMemo(
    () => filterPickerItems(folders ?? [], search, (folder) => folder),
    [folders, search]
  );

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
      <section>
        <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
          Folders on this machine
        </h3>
        <div className="border border-chatroom-border">
          <PickerSearch value={search} onChange={setSearch} placeholder="Search folders…" />
          <PickerScrollBody maxHeightClassName="max-h-48">
            <FolderListBody
              folders={folders}
              visibleFolders={visibleFolders}
              search={search}
              trimmedPath={trimmedPath}
              onSelect={setSelectedPath}
            />
          </PickerScrollBody>
        </div>
      </section>

      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <SetupFolderPickerField
          label="Folder path"
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
