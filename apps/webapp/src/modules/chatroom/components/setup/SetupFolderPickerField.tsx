'use client';

import { FolderOpen, Loader2 } from 'lucide-react';
import { memo, type ReactNode } from 'react';

/** Folder picker state for a path field. Built by useSetupWorkspaceFolderPicker. */
export interface FolderPickerState {
  isPending: boolean;
  isTimedOut: boolean;
  requestId: string | null;
  machineDisplayName: string | null;
  /** Last picker or browse error. Cleared by the next browse or reset. */
  error: string | null;
  onBrowse: () => void;
  onRetryAfterTimeout: () => void;
}

interface SetupFolderPickerFieldProps {
  /** Visible heading, and the input's accessible name. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Disables only the text input. */
  inputDisabled: boolean;
  /** Disables only the Browse button. A typed path stays editable. */
  browseDisabled: boolean;
  picker: FolderPickerState;
  /** Shown under the input row, for example a clone target hint. */
  hint?: ReactNode;
}

function BrowseIcon({ isPending }: { isPending: boolean }) {
  return isPending ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />;
}

function BrowseButton({
  onBrowse,
  disabled,
  isPending,
}: {
  onBrowse: () => void;
  disabled: boolean;
  isPending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onBrowse}
      disabled={disabled || isPending}
      className="flex h-10 shrink-0 items-center gap-2 px-3 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50 sm:h-9"
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

/** Picker feedback: an error, waiting for the daemon, or a retry prompt after a timeout. */
function PickerStatus({ picker }: { picker: FolderPickerState }) {
  return (
    <>
      {picker.error && <p className="text-xs text-chatroom-status-error">{picker.error}</p>}
      {picker.requestId && picker.isPending && (
        <WaitingMessage machineDisplayName={picker.machineDisplayName} />
      )}
      {picker.isTimedOut && (
        <button
          type="button"
          onClick={picker.onRetryAfterTimeout}
          className="text-xs text-chatroom-accent hover:text-chatroom-text-primary text-left"
        >
          Folder picker timed out — click to try again
        </button>
      )}
    </>
  );
}

/** The one folder-path field: a text input, a Browse button, and the picker status. */
export const SetupFolderPickerField = memo(function SetupFolderPickerField({
  label,
  value,
  onChange,
  placeholder,
  inputDisabled,
  browseDisabled,
  picker,
  hint,
}: SetupFolderPickerFieldProps) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-2">
        {label}
      </h3>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={inputDisabled}
            className="min-w-0 h-10 sm:h-9 flex-1 bg-chatroom-bg-tertiary border border-chatroom-border text-sm font-mono text-chatroom-text-primary px-3 focus:outline-none focus:border-chatroom-accent disabled:opacity-50"
          />
          <BrowseButton
            onBrowse={picker.onBrowse}
            disabled={browseDisabled}
            isPending={picker.isPending}
          />
        </div>
        {hint}
        <PickerStatus picker={picker} />
      </div>
    </div>
  );
});
