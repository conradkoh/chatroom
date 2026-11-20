'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useRef, useState, type FormEvent, type RefObject } from 'react';

import { SetupFolderPickerField } from '../../../components/setup/SetupFolderPickerField';
import type { FolderPickerState } from '../../../components/setup/SetupFolderPickerField';
import { useSetupWorkspaceFolderPicker } from '../../../components/setup/useSetupWorkspaceFolderPicker';
import { getMachineErrorCopy } from '../lib/machineErrorCopy';

const ADD_FALLBACK_COPY = 'Could not add the project root. Try again.';

export interface AddProjectRootFormProps {
  machineId: string;
  /** alias || hostname; used in the picker waiting text. */
  displayName: string;
  hostname: string;
  alias?: string;
  /** False only when the machine is known to be offline; undefined (checking) stays enabled. */
  offline: boolean;
  /** At MAX_PROJECT_ROOTS the design disables Add even though the server would collapse. */
  atLimit: boolean;
  onAdd: (path: string) => Promise<{ path: string; collapsedPaths: string[] }>;
}

/** Success copy. A collapse note names the roots the new root replaced. */
function formatAddedNote(result: { path: string; collapsedPaths: string[] }): string {
  if (result.collapsedPaths.length === 0) return `Added ${result.path}.`;
  const noun = result.collapsedPaths.length === 1 ? 'root' : 'roots';
  return `Added ${result.path}. Replaced ${result.collapsedPaths.length} nested ${noun}: ${result.collapsedPaths.join(', ')}`;
}

function AddRootButton({ disabled, adding }: { disabled: boolean; adding: boolean }) {
  return (
    <button
      type="submit"
      data-testid="project-roots-add"
      disabled={disabled}
      className="flex h-10 w-full shrink-0 items-center justify-center gap-2 bg-chatroom-accent px-4 text-xs font-bold uppercase tracking-wide text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 sm:h-9 sm:w-auto"
    >
      {adding && <Loader2 size={14} className="animate-spin" />}
      {adding ? 'Adding…' : 'Add root'}
    </button>
  );
}

/** The error line under the input; only the add form owns add errors. */
function AddErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      data-testid="project-roots-error"
      className="text-xs text-chatroom-status-error"
    >
      {error}
    </p>
  );
}

/** Always mounted so screen readers announce each add. */
function AddSuccessNote({ success }: { success: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="project-roots-success"
      className="text-xs text-chatroom-status-success"
    >
      {success}
    </div>
  );
}

interface PathFieldProps {
  path: string;
  onChange: (value: string) => void;
  picker: FolderPickerState;
  inputRef: RefObject<HTMLInputElement | null>;
  error: string | null;
  adding: boolean;
  offline: boolean;
  atLimit: boolean;
  displayName: string;
}

function PathField({
  path,
  onChange,
  picker,
  inputRef,
  error,
  adding,
  offline,
  atLimit,
  displayName,
}: PathFieldProps) {
  return (
    <SetupFolderPickerField
      variant="clone"
      heading="Folder path"
      inputAriaLabel="Project root path"
      waitingText={`Waiting for a folder to be selected on ${displayName}…`}
      value={path}
      onChange={onChange}
      placeholder="/Users/you/projects"
      inputDisabled={offline}
      browseDisabled={offline}
      picker={picker}
      inputRef={inputRef}
      invalid={error !== null}
      stackOnMobile
      actions={
        <AddRootButton
          disabled={offline || atLimit || adding || path.trim() === ''}
          adding={adding}
        />
      }
      hint={<AddErrorLine error={error} />}
    />
  );
}

/**
 * Typed or Browse-picked path plus the Add action.
 *
 * Browse only fills the input; submitting is always the user's explicit action.
 * The success live region stays mounted so screen readers announce every add.
 */
export function AddProjectRootForm({
  machineId,
  displayName,
  hostname,
  alias,
  offline,
  atLimit,
  onAdd,
}: AddProjectRootFormProps) {
  const [path, setPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Stable: it is an effect dependency inside useSetupWorkspaceFolderPicker.
  const handlePicked = useCallback((picked: string) => {
    setPath(picked);
    setError(null);
    setSuccess('');
  }, []);

  const { picker } = useSetupWorkspaceFolderPicker({
    selectedMachineId: machineId,
    selectedMachine: { hostname, alias },
    onPathSelected: handlePicked,
  });

  const handleChange = useCallback((value: string) => {
    setPath(value);
    setError(null);
    setSuccess('');
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = path.trim();
      if (offline || atLimit || adding || trimmed === '') return;

      setAdding(true);
      setError(null);
      setSuccess('');
      try {
        const result = await onAdd(trimmed);
        setPath('');
        setSuccess(formatAddedNote(result));
        setAdding(false);
        inputRef.current?.focus();
      } catch (err) {
        setError(getMachineErrorCopy(err, ADD_FALLBACK_COPY));
        setAdding(false);
      }
    },
    [adding, atLimit, offline, onAdd, path]
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      <PathField
        path={path}
        onChange={handleChange}
        picker={picker}
        inputRef={inputRef}
        error={error}
        adding={adding}
        offline={offline}
        atLimit={atLimit}
        displayName={displayName}
      />
      <AddSuccessNote success={success} />
    </form>
  );
}
