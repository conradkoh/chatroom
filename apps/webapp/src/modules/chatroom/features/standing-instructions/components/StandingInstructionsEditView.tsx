'use client';

import { StandingInstructionsEditorForm } from './StandingInstructionsEditorForm';

export interface StandingInstructionsEditViewProps {
  draft: string;
  draftTitle: string;
  onDraftChange: (value: string) => void;
  onDraftTitleChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  mobile?: boolean;
}

export function StandingInstructionsEditView({
  draft,
  draftTitle,
  onDraftChange,
  onDraftTitleChange,
  onConfirm,
  onCancel,
  confirmDisabled,
  mobile,
}: StandingInstructionsEditViewProps) {
  return (
    <div data-testid="standing-instructions-editing-panel" className="flex flex-col gap-1.5">
      <StandingInstructionsEditorForm
        draft={draft}
        draftTitle={draftTitle}
        onDraftChange={onDraftChange}
        onDraftTitleChange={onDraftTitleChange}
        onConfirm={onConfirm}
        onCancel={onCancel}
        confirmDisabled={confirmDisabled}
        mobile={mobile}
      />
    </div>
  );
}
