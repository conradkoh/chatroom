'use client';

import { StandingInstructionsEditorForm } from './StandingInstructionsEditorForm';

export interface StandingInstructionsEditViewProps {
  draft: string;
  draftName: string;
  onDraftChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  mobile?: boolean;
}

export function StandingInstructionsEditView({
  draft,
  draftName,
  onDraftChange,
  onDraftNameChange,
  onConfirm,
  onCancel,
  mobile,
}: StandingInstructionsEditViewProps) {
  return (
    <div data-testid="standing-instructions-editing-panel" className="flex flex-col gap-1.5">
      <StandingInstructionsEditorForm
        draft={draft}
        draftName={draftName}
        onDraftChange={onDraftChange}
        onDraftNameChange={onDraftNameChange}
        onConfirm={onConfirm}
        onCancel={onCancel}
        mobile={mobile}
      />
    </div>
  );
}
