'use client';

import { StandingInstructionsCreateNewButton } from './StandingInstructionsCreateNewButton';
import { StandingInstructionsEditorForm } from './StandingInstructionsEditorForm';
import { StandingInstructionsHistoryList } from './StandingInstructionsHistoryList';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';
import type { StandingInstructionsAddSelection } from '../types/standingInstructionsDialog';

export interface StandingInstructionsAddViewProps {
  historyTop3: StandingInstructionHistoryItem[];
  selection: StandingInstructionsAddSelection;
  draft: string;
  draftName: string;
  onDraftChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
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
  draftName,
  onDraftChange,
  onDraftNameChange,
  onSelectHistory,
  onSelectCreateNew,
  onViewMore,
  onConfirm,
  onCancel,
  confirmDisabled,
  mobile,
}: StandingInstructionsAddViewProps) {
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
        <StandingInstructionsEditorForm
          draft={draft}
          draftName={draftName}
          onDraftChange={onDraftChange}
          onDraftNameChange={onDraftNameChange}
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmDisabled={confirmDisabled}
          mobile={mobile}
        />
      ) : (
        <div className="flex items-center gap-2">
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
