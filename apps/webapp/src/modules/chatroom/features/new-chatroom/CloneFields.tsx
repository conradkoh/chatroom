'use client';

import { validateGitCloneUrl } from '@workspace/shared/domain/git-clone';
import { FolderOpen } from 'lucide-react';

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
  isPickingParent: boolean;
  isPickerTimedOut: boolean;
  pickerError: string | null;
  machineName: string;
  onRepoUrlChange: (value: string) => void;
  onCloneToChange: (value: string) => void;
  onBrowse: () => void;
  onRetryBrowse: () => void;
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

function CloneToField({
  cloneTo,
  locked,
  browseDisabled,
  machineName,
  onChange,
  onBrowse,
}: {
  cloneTo: string;
  locked: boolean;
  browseDisabled: boolean;
  machineName: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        Clone to
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label="Clone to"
          value={cloneTo}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`A folder on ${machineName}`}
          disabled={locked}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          onClick={onBrowse}
          disabled={browseDisabled}
          className="flex h-10 shrink-0 items-center gap-2 px-3 py-2 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50 sm:h-9"
        >
          <FolderOpen size={14} />
          Browse
        </button>
      </div>
      <TargetHint cloneTo={cloneTo} />
    </div>
  );
}

/** Folder-picker progress: a pending choice, a timeout to retry, or an error. */
function PickerStatus({
  isPickingParent,
  isPickerTimedOut,
  pickerError,
  machineName,
  onRetry,
}: {
  isPickingParent: boolean;
  isPickerTimedOut: boolean;
  pickerError: string | null;
  machineName: string;
  onRetry: () => void;
}) {
  return (
    <>
      {pickerError && <p className="text-xs text-chatroom-status-error">{pickerError}</p>}
      {isPickingParent && (
        <p className="text-xs text-chatroom-text-muted">
          Waiting for a folder choice on {machineName}…
        </p>
      )}
      {isPickerTimedOut && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-chatroom-accent hover:text-chatroom-text-primary text-left"
        >
          Folder picker timed out — click to try again
        </button>
      )}
    </>
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
      <CloneToField
        cloneTo={props.cloneTo}
        locked={props.locked}
        browseDisabled={props.browseDisabled}
        machineName={props.machineName}
        onChange={props.onCloneToChange}
        onBrowse={props.onBrowse}
      />
      <PickerStatus
        isPickingParent={props.isPickingParent}
        isPickerTimedOut={props.isPickerTimedOut}
        pickerError={props.pickerError}
        machineName={props.machineName}
        onRetry={props.onRetryBrowse}
      />
    </div>
  );
}
