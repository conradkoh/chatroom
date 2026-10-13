'use client';

import { validateGitCloneUrl } from '@workspace/shared/domain/git-clone';

import {
  SetupFolderPickerField,
  type FolderPickerState,
} from '../../components/setup/SetupFolderPickerField';

const INPUT_CLASS =
  'min-w-0 flex-1 h-10 sm:h-9 bg-chatroom-bg-tertiary border border-chatroom-border text-sm font-mono text-chatroom-text-primary px-3 focus:outline-none focus:border-chatroom-accent disabled:opacity-50';

function RepoUrlHint({ repoUrl }: { repoUrl: string }) {
  const result = validateGitCloneUrl(repoUrl);
  if (repoUrl.trim() === '' || result.ok) return null;
  return <p className="text-xs text-chatroom-status-error">{result.reason}</p>;
}

function TargetHint({ cloneTo }: { cloneTo: string }) {
  const value = cloneTo.trim();
  if (value === '' || value.startsWith('/')) return null;
  return (
    <p className="text-xs text-chatroom-status-error">
      Clone to must be an absolute path starting with /.
    </p>
  );
}

export interface CloneFieldsProps {
  repoUrl: string;
  cloneTo: string;
  /** True while a clone is waiting or running. Both fields are read-only then. */
  locked: boolean;
  browseDisabled: boolean;
  machineName: string;
  picker: FolderPickerState;
  onRepoUrlChange: (value: string) => void;
  onCloneToChange: (value: string) => void;
}

function RepoUrlField({
  repoUrl,
  locked,
  onChange,
}: {
  repoUrl: string;
  locked: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        Repository URL
        <input
          type="text"
          aria-label="Repository URL"
          value={repoUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://github.com/owner/repo.git"
          disabled={locked}
          className={`${INPUT_CLASS} w-full mt-2`}
        />
      </label>
      <RepoUrlHint repoUrl={repoUrl} />
    </div>
  );
}

/** Repository URL and target folder, with inline validation and the parent-folder picker. */
export function CloneFields(props: CloneFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <RepoUrlField
        repoUrl={props.repoUrl}
        locked={props.locked}
        onChange={props.onRepoUrlChange}
      />
      <SetupFolderPickerField
        variant="clone"
        heading="Clone to"
        inputAriaLabel="Clone to"
        waitingText={`Waiting for a folder choice on ${props.machineName}…`}
        value={props.cloneTo}
        onChange={props.onCloneToChange}
        placeholder={`A folder on ${props.machineName}`}
        inputDisabled={props.locked}
        browseDisabled={props.browseDisabled}
        picker={props.picker}
        hint={<TargetHint cloneTo={props.cloneTo} />}
      />
    </div>
  );
}
