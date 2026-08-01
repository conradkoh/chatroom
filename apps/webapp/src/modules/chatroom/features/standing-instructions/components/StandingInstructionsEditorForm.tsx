'use client';

import { StandingInstructionsDialogFooter } from './StandingInstructionsDialogFooter';
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
  showFooter?: boolean;
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
  showFooter = true,
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
      {showFooter ? (
        <StandingInstructionsDialogFooter
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmDisabled={confirmDisabled}
          mobile={mobile}
        />
      ) : null}
    </div>
  );
}
