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

/** The add error line under the input. Picker errors stay in SetupFolderPickerField. */
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

interface AddRootMutation {
  adding: boolean;
  error: string | null;
  success: string;
  setError: (error: string | null) => void;
  setSuccess: (success: string) => void;
  /** Resolves true on success, false on a mapped failure. */
  addRoot: (path: string) => Promise<boolean>;
}

/** The add mutation's pending/error/success state, separate from the path and picker. */
function useAddRootMutation(
  onAdd: AddProjectRootFormProps['onAdd'],
  inputRef: RefObject<HTMLInputElement | null>
): AddRootMutation {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState('');

  const addRoot = useCallback(
    async (path: string) => {
      setAdding(true);
      setError(null);
      setSuccess('');
      try {
        const result = await onAdd(path);
        setSuccess(formatAddedNote(result));
        inputRef.current?.focus();
        return true;
      } catch (err) {
        setError(getMachineErrorCopy(err, ADD_FALLBACK_COPY));
        return false;
      } finally {
        setAdding(false);
      }
    },
    [inputRef, onAdd]
  );

  return { adding, error, success, setError, setSuccess, addRoot };
}

interface AddRootFormState {
  path: string;
  adding: boolean;
  error: string | null;
  success: string;
  inputRef: RefObject<HTMLInputElement | null>;
  picker: FolderPickerState;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/** Typed path, add mutation state and the Browse picker, in one testable unit. */
function useAddRootForm({
  machineId,
  hostname,
  alias,
  offline,
  atLimit,
  onAdd,
}: AddProjectRootFormProps): AddRootFormState {
  const [path, setPath] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { adding, error, success, setError, setSuccess, addRoot } = useAddRootMutation(
    onAdd,
    inputRef
  );

  // Stable: it is an effect dependency inside useSetupWorkspaceFolderPicker.
  const handlePicked = useCallback(
    (picked: string) => {
      setPath(picked);
      setError(null);
      setSuccess('');
    },
    [setError, setSuccess]
  );

  const { picker } = useSetupWorkspaceFolderPicker({
    selectedMachineId: machineId,
    selectedMachine: { hostname, alias },
    onPathSelected: handlePicked,
  });

  const handleChange = useCallback(
    (value: string) => {
      setPath(value);
      setError(null);
      setSuccess('');
    },
    [setError, setSuccess]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const submitted = path;
      const trimmed = submitted.trim();
      const blocked = [offline, atLimit, adding, trimmed === ''].some(Boolean);
      if (blocked) return;
      // Clear only what was submitted: text typed while the add was in flight must survive.
      if (await addRoot(trimmed)) setPath((current) => (current === submitted ? '' : current));
    },
    [adding, addRoot, atLimit, offline, path]
  );

  return {
    path,
    adding,
    error,
    success,
    inputRef,
    picker,
    onChange: handleChange,
    onSubmit: handleSubmit,
  };
}

/**
 * Typed or Browse-picked path plus the Add action.
 *
 * Browse only fills the input; submitting is always the user's explicit action.
 */
export function AddProjectRootForm(props: AddProjectRootFormProps) {
  const form = useAddRootForm(props);
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <PathField
        path={form.path}
        onChange={form.onChange}
        picker={form.picker}
        inputRef={form.inputRef}
        error={form.error}
        adding={form.adding}
        offline={props.offline}
        atLimit={props.atLimit}
        displayName={props.displayName}
      />
      <AddSuccessNote success={form.success} />
    </form>
  );
}
