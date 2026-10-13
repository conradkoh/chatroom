'use client';

import { FolderOpen, Loader2 } from 'lucide-react';
import { memo } from 'react';

interface SetupFolderPickerFieldProps {
  selectedPath: string;
  onPathChange: (path: string) => void;
  placeholder: string;
  disabled: boolean;
  isPending: boolean;
  isConfirming: boolean;
  isTimedOut: boolean;
  requestId: string | null;
  machineDisplayName: string | null;
  onBrowse: () => void;
  onRetryAfterTimeout: () => void;
  /** Disables only the Browse button. A typed path stays editable. */
  browseDisabled?: boolean;
  /** Accessible name for the path input. */
  inputAriaLabel?: string;
}

function BrowseIcon({ isPending }: { isPending: boolean }) {
  return isPending ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />;
}

function BrowseButton({
  onBrowse,
  browseDisabled,
  disabled,
  isPending,
  isConfirming,
}: {
  onBrowse: () => void;
  browseDisabled: boolean;
  disabled: boolean;
  isPending: boolean;
  isConfirming: boolean;
}) {
  const blocked = browseDisabled || disabled || isConfirming;
  return (
    <button
      type="button"
      onClick={onBrowse}
      disabled={blocked || isPending}
      className="flex items-center gap-2 px-3 py-2 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50"
    >
      <BrowseIcon isPending={isPending} />
      Browse
    </button>
  );
}

function WaitingMessage({ machineDisplayName }: { machineDisplayName: string | null }) {
  return (
    <p className="text-xs text-chatroom-text-muted">
      Waiting for folder selection on {machineDisplayName ?? 'machine'}...
    </p>
  );
}

/** Picker feedback: waiting for the daemon, or a retry prompt after the picker timed out. */
function PickerStatus({
  requestId,
  isPending,
  isTimedOut,
  machineDisplayName,
  onRetryAfterTimeout,
}: {
  requestId: string | null;
  isPending: boolean;
  isTimedOut: boolean;
  machineDisplayName: string | null;
  onRetryAfterTimeout: () => void;
}) {
  return (
    <>
      {requestId && isPending && <WaitingMessage machineDisplayName={machineDisplayName} />}
      {isTimedOut && (
        <button
          type="button"
          onClick={onRetryAfterTimeout}
          className="text-xs text-chatroom-accent hover:text-chatroom-text-primary text-left"
        >
          Folder picker timed out — click to try again
        </button>
      )}
    </>
  );
}

export const SetupFolderPickerField = memo(function SetupFolderPickerField({
  selectedPath,
  onPathChange,
  placeholder,
  disabled,
  isPending,
  isConfirming,
  isTimedOut,
  requestId,
  machineDisplayName,
  onBrowse,
  onRetryAfterTimeout,
  browseDisabled = false,
  inputAriaLabel,
}: SetupFolderPickerFieldProps) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Workspace Folder
      </h3>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label={inputAriaLabel}
            value={selectedPath}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled || isPending}
            className="flex-1 bg-chatroom-bg-tertiary border border-chatroom-border text-sm font-mono text-chatroom-text-primary px-3 py-2 focus:outline-none focus:border-chatroom-accent disabled:opacity-50"
          />
          <BrowseButton
            onBrowse={onBrowse}
            browseDisabled={browseDisabled}
            disabled={disabled}
            isPending={isPending}
            isConfirming={isConfirming}
          />
        </div>
        <PickerStatus
          requestId={requestId}
          isPending={isPending}
          isTimedOut={isTimedOut}
          machineDisplayName={machineDisplayName}
          onRetryAfterTimeout={onRetryAfterTimeout}
        />
      </div>
    </div>
  );
});
