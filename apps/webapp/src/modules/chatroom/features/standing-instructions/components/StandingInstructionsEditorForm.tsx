'use client';

import { onStandingEditorKeyDown } from './standingInstructionsEditorUtils';
import { StandingInstructionsTitleInput } from './StandingInstructionsTitleInput';

export interface StandingInstructionsEditorFormProps {
  draft: string;
  draftTitle: string;
  onDraftChange: (value: string) => void;
  onDraftTitleChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  mobile?: boolean;
  showTitleInput?: boolean;
  autoFocus?: boolean;
}

export function StandingInstructionsEditorForm({
  draft,
  draftTitle,
  onDraftChange,
  onDraftTitleChange,
  onConfirm,
  onCancel,
  confirmDisabled,
  mobile,
  showTitleInput = true,
  autoFocus = true,
}: StandingInstructionsEditorFormProps) {
  const textareaClasses = mobile
    ? 'w-full min-h-[120px] bg-chatroom-bg-primary border border-chatroom-border px-3 py-3 text-sm text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none'
    : 'w-full bg-chatroom-bg-primary border border-chatroom-border px-2 py-1 text-xs text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none';

  return (
    <div className="flex flex-col gap-1.5">
      {showTitleInput ? (
        <StandingInstructionsTitleInput
          value={draftTitle}
          onChange={onDraftTitleChange}
          mobile={mobile}
        />
      ) : null}
      <textarea
        autoFocus={autoFocus}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) =>
          onStandingEditorKeyDown(
            e,
            onCancel,
            confirmDisabled
              ? () => {
                  // Blocked until content + title are filled
                }
              : onConfirm
          )
        }
        placeholder="Enter standing instructions…"
        rows={mobile ? 5 : 3}
        className={textareaClasses}
      />
      <div className={`flex items-center gap-2 ${mobile ? 'items-stretch' : ''}`}>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          className={
            mobile
              ? 'min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed'
              : 'text-xs font-bold uppercase tracking-wider px-2 py-0.5 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed'
          }
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={
            mobile
              ? 'min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors border border-chatroom-border'
              : 'text-xs font-bold uppercase tracking-wider px-2 py-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors'
          }
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
