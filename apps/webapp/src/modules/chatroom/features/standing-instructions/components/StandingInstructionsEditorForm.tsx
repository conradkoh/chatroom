'use client';

import { onStandingEditorKeyDown } from './standingInstructionsEditorUtils';
import { StandingInstructionsTitleInput } from './StandingInstructionsTitleInput';
import { chatroomIndustrialInputClassName } from '../../../components/shared/industrialDialogStyles';

import { cn } from '@/lib/utils';

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
  const textareaClasses = cn(
    'w-full px-3 py-2 text-sm resize-none',
    mobile ? 'min-h-[120px]' : 'min-h-[80px]',
    chatroomIndustrialInputClassName
  );

  return (
    <div className="flex flex-col gap-1.5">
      {showTitleInput ? (
        <StandingInstructionsTitleInput value={draftTitle} onChange={onDraftTitleChange} />
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
    </div>
  );
}
