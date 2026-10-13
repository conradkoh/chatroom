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

/** Shown with the retry prompt when the picker timed out. */
const PICKER_TIMEOUT_HINT =
  'Folder picker timed out. Ensure the daemon is running on the selected machine.';

type SetupFolderPickerFieldVariant = 'setup' | 'clone';

interface SetupFolderPickerFieldProps {
  /**
   * The two layouts the field replaces. 'setup' is the wizard and checklist heading, with the status
   * below the Browse row. 'clone' is the clone form's smaller heading, with the status above the
   * retry prompt. The two keep their own order and copy.
   */
  variant: SetupFolderPickerFieldVariant;
  /** Visible heading. */
  heading: string;
  /** The input's accessible name. */
  inputAriaLabel: string;
  /** Shown while the picker waits for the daemon. */
  waitingText: string;
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

function FieldHeading({
  variant,
  children,
}: {
  variant: SetupFolderPickerFieldVariant;
  children: string;
}) {
  if (variant === 'clone') {
    return (
      <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        {children}
      </div>
    );
  }
  return (
    <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-2">
      {children}
    </h3>
  );
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

/** Picker feedback: the error, the waiting line, and the retry prompt, in the variant's order. */
function PickerStatus({
  variant,
  picker,
  waitingText,
}: {
  variant: SetupFolderPickerFieldVariant;
  picker: FolderPickerState;
  waitingText: string;
}) {
  const errorLine = picker.error ?? (picker.isTimedOut ? PICKER_TIMEOUT_HINT : null);
  const error = errorLine ? (
    <p className="text-xs text-chatroom-status-error">{errorLine}</p>
  ) : null;
  const waiting = picker.isPending ? (
    <p className="text-xs text-chatroom-text-muted">{waitingText}</p>
  ) : null;
  const retry = picker.isTimedOut ? (
    <button
      type="button"
      onClick={picker.onRetryAfterTimeout}
      className="text-xs text-chatroom-accent hover:text-chatroom-text-primary text-left"
    >
      Folder picker timed out — click to try again
    </button>
  ) : null;

  if (variant === 'clone') {
    return (
      <>
        {error}
        {waiting}
        {retry}
      </>
    );
  }
  return (
    <>
      {waiting}
      {retry}
      {error}
    </>
  );
}

/** The one folder-path field: a heading, a text input, a Browse button, and the picker status. */
export const SetupFolderPickerField = memo(function SetupFolderPickerField({
  variant,
  heading,
  inputAriaLabel,
  waitingText,
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
      <FieldHeading variant={variant}>{heading}</FieldHeading>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label={inputAriaLabel}
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
        <PickerStatus variant={variant} picker={picker} waitingText={waitingText} />
      </div>
    </div>
  );
});
