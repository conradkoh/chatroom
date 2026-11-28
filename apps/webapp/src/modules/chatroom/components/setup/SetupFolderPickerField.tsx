'use client';

import { FolderOpen } from 'lucide-react';
import { memo, useCallback, useId, useRef, type ReactNode, type Ref } from 'react';

import { RemoteFolderBrowser } from './RemoteFolderBrowser';

import type { RemoteFolderBrowserState } from '@/hooks/useRemoteFolderBrowser';

/** Folder picker state for a path field. Built by useSetupWorkspaceFolderPicker. */
export interface FolderPickerState {
  /** The open browser session, or null while closed. */
  browser: RemoteFolderBrowserState | null;
  machineDisplayName: string | null;
  /** Open or select error line. Cleared by the next browse, select, cancel or reset. */
  error: string | null;
  /** Opens a session at the typed value (empty or relative → machine home). */
  onBrowse: (startPath: string) => void;
  /** Cancels the open session. */
  onCloseBrowser: () => void;
}

type SetupFolderPickerFieldVariant = 'setup' | 'clone';

interface SetupFolderPickerFieldProps {
  /**
   * Chooses the heading style only. 'setup' is the wizard and checklist heading; 'clone' is the
   * clone form's smaller heading. The browser and the error line sit in the same place in both.
   */
  variant: SetupFolderPickerFieldVariant;
  /** Visible heading. */
  heading: string;
  /** The input's accessible name. */
  inputAriaLabel: string;
  /** Caption shown while the browser loads its first listing. */
  waitingText: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Disables only the text input. Browsing never changes it. */
  inputDisabled: boolean;
  /** Disables only the Browse button. A typed path stays editable. */
  browseDisabled: boolean;
  picker: FolderPickerState;
  /** Shown under the input row, for example a clone target hint. */
  hint?: ReactNode;
  /** Extra control rendered after Browse in the input row (e.g. an "Add root" submit button). */
  actions?: ReactNode;
  /** Marks the input invalid: aria-invalid + error border. */
  invalid?: boolean;
  /** Ref to the text input, for callers that restore focus. */
  inputRef?: Ref<HTMLInputElement>;
  /** Below `sm`, stack input / Browse / actions vertically with full-width buttons. */
  stackOnMobile?: boolean;
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

/** Sets a ref from either a callback or an object ref, so the field can also keep its own. */
function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

/**
 * The one folder-path field: a heading, a text input, a Browse button that toggles the inline
 * remote browser, and the field's error line. The browser opens under the input row.
 */
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
  actions,
  invalid,
  inputRef,
  stackOnMobile,
}: SetupFolderPickerFieldProps) {
  const panelId = useId();
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const browseRef = useRef<HTMLButtonElement | null>(null);
  const mergedInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      localInputRef.current = node;
      assignRef(inputRef, node);
    },
    [inputRef]
  );

  const isOpen = picker.browser !== null;
  const onBrowseClick = useCallback(() => {
    if (isOpen) picker.onCloseBrowser();
    else picker.onBrowse(value);
  }, [isOpen, picker, value]);

  // Focus returns to the value that was chosen, or to the button that opened the browser.
  const onBrowserExit = useCallback((reason: 'select' | 'cancel') => {
    if (reason === 'select') localInputRef.current?.focus();
    else browseRef.current?.focus();
  }, []);

  return (
    <div>
      <FieldHeading variant={variant}>{heading}</FieldHeading>
      <div className="flex flex-col gap-3">
        <div
          className={
            stackOnMobile
              ? 'flex flex-col gap-2 sm:flex-row sm:items-center'
              : 'flex items-center gap-2'
          }
        >
          <input
            ref={mergedInputRef}
            type="text"
            aria-label={inputAriaLabel}
            aria-invalid={invalid || undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={inputDisabled}
            className={`min-w-0 h-10 sm:h-9 bg-chatroom-bg-tertiary border text-sm font-mono text-chatroom-text-primary px-3 focus:outline-none disabled:opacity-50 ${
              stackOnMobile ? 'w-full flex-1 basis-auto' : 'flex-1'
            } ${
              invalid
                ? 'border-chatroom-status-error focus:border-chatroom-status-error'
                : 'border-chatroom-border focus:border-chatroom-accent'
            }`}
          />
          <button
            ref={browseRef}
            type="button"
            onClick={onBrowseClick}
            disabled={browseDisabled}
            aria-expanded={isOpen}
            aria-controls={isOpen ? panelId : undefined}
            className={`flex h-10 shrink-0 items-center gap-2 px-3 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50 sm:h-9 ${
              isOpen ? 'bg-chatroom-bg-hover' : ''
            } ${stackOnMobile ? 'w-full justify-center sm:w-auto' : ''}`}
          >
            <FolderOpen size={14} aria-hidden />
            Browse
          </button>
          {actions}
        </div>
        {hint}
        {picker.browser && (
          <RemoteFolderBrowser
            id={panelId}
            browser={picker.browser}
            loadingCaption={waitingText}
            onExit={onBrowserExit}
          />
        )}
        {picker.error && <p className="text-xs text-chatroom-status-error">{picker.error}</p>}
      </div>
    </div>
  );
});
