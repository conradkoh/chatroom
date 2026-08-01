'use client';

import { StandingInstructionsCreateNewButton } from './StandingInstructionsCreateNewButton';
import { StandingInstructionsDialogFooter } from './StandingInstructionsDialogFooter';
import { StandingInstructionsEditorForm } from './StandingInstructionsEditorForm';
import { StandingInstructionsHistoryList } from './StandingInstructionsHistoryList';
import { StandingInstructionsTitleInput } from './StandingInstructionsTitleInput';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';
import type { StandingInstructionsAddSelection } from '../types/standingInstructionsDialog';

export interface StandingInstructionsAddViewProps {
  historyTop3: StandingInstructionHistoryItem[];
  selection: StandingInstructionsAddSelection;
  draft: string;
  draftTitle: string;
  onDraftChange: (value: string) => void;
  onDraftTitleChange: (value: string) => void;
  onSelectHistory: (item: StandingInstructionHistoryItem) => void;
  onSelectCreateNew: () => void;
  onViewMore: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled: boolean;
  mobile?: boolean;
}

export function StandingInstructionsAddView({
  historyTop3,
  selection,
  draft,
  draftTitle,
  onDraftChange,
  onDraftTitleChange,
  onSelectHistory,
  onSelectCreateNew,
  onViewMore,
  onConfirm,
  onCancel,
  confirmDisabled,
  mobile,
}: StandingInstructionsAddViewProps) {
  const titleInput =
    selection !== null ? (
      <StandingInstructionsTitleInput
        value={draftTitle}
        onChange={onDraftTitleChange}
        mobile={mobile}
      />
    ) : null;

  const body = (
    <div data-testid="standing-instructions-adding-panel" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
          Standing Instructions
        </span>
        <button
          type="button"
          onClick={onViewMore}
          data-testid="standing-instructions-view-more"
          className="text-[10px] font-bold uppercase tracking-wider text-chatroom-accent hover:opacity-80 cursor-pointer shrink-0"
        >
          View more
        </button>
      </div>
      <StandingInstructionsHistoryList
        items={historyTop3}
        selection={selection}
        onSelect={onSelectHistory}
      />
      <StandingInstructionsCreateNewButton
        selected={selection === 'create-new'}
        onSelect={onSelectCreateNew}
        mobile={mobile}
      />
      {selection === 'create-new' ? (
        <>
          {titleInput}
          <StandingInstructionsEditorForm
            draft={draft}
            draftTitle={draftTitle}
            onDraftChange={onDraftChange}
            onDraftTitleChange={onDraftTitleChange}
            onConfirm={onConfirm}
            onCancel={onCancel}
            confirmDisabled={confirmDisabled}
            mobile={mobile}
            showTitleInput={false}
          />
        </>
      ) : (
        <>
          {titleInput}
          <StandingInstructionsDialogFooter
            onConfirm={onConfirm}
            onCancel={onCancel}
            confirmDisabled={confirmDisabled}
            mobile={mobile}
          />
        </>
      )}
    </div>
  );

  if (mobile) {
    return (
      <div data-testid="standing-instructions-mobile-add-body" className="flex flex-col gap-3 py-3">
        {body}
      </div>
    );
  }

  return body;
}
