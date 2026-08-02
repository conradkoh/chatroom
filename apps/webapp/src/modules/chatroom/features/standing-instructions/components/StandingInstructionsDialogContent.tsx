'use client';

import { StandingInstructionsAddView } from './StandingInstructionsAddView';
import { StandingInstructionsEditView } from './StandingInstructionsEditView';
import { StandingInstructionsHistoryPickerView } from './StandingInstructionsHistoryPickerView';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';
import type {
  StandingInstructionsAddSelection,
  StandingInstructionsDialogView,
} from '../types/standingInstructionsDialog';

export interface StandingInstructionsDialogContentProps {
  view: StandingInstructionsDialogView;
  mobile?: boolean;
  history: StandingInstructionHistoryItem[];
  historyTop3: StandingInstructionHistoryItem[];
  addSelection: StandingInstructionsAddSelection;
  draft: string;
  draftTitle: string;
  confirmDisabled: boolean;
  onDraftChange: (value: string) => void;
  onDraftTitleChange: (value: string) => void;
  onSelectHistory: (item: StandingInstructionHistoryItem) => void;
  onSelectCreateNew: () => void;
  onViewMore: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** Called when the user requests deleting a preset from the history picker. */
  onDeletePreset?: (historyId: string) => void;
}

export function StandingInstructionsDialogContent({
  view,
  mobile,
  history,
  historyTop3,
  addSelection,
  draft,
  draftTitle,
  confirmDisabled,
  onDraftChange,
  onDraftTitleChange,
  onSelectHistory,
  onSelectCreateNew,
  onViewMore,
  onConfirm,
  onCancel,
  onDeletePreset,
}: StandingInstructionsDialogContentProps) {
  switch (view) {
    case 'add':
      return (
        <StandingInstructionsAddView
          historyTop3={historyTop3}
          selection={addSelection}
          draft={draft}
          draftTitle={draftTitle}
          onDraftChange={onDraftChange}
          onDraftTitleChange={onDraftTitleChange}
          onSelectHistory={onSelectHistory}
          onSelectCreateNew={onSelectCreateNew}
          onViewMore={onViewMore}
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmDisabled={confirmDisabled}
          mobile={mobile}
        />
      );
    case 'edit':
      return (
        <StandingInstructionsEditView
          draft={draft}
          draftTitle={draftTitle}
          onDraftChange={onDraftChange}
          onDraftTitleChange={onDraftTitleChange}
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmDisabled={confirmDisabled}
          mobile={mobile}
        />
      );
    case 'history':
      return (
        <StandingInstructionsHistoryPickerView
          items={history}
          onSelect={(item) => onSelectHistory(item)}
          onDeletePreset={onDeletePreset}
        />
      );
    default:
      return null;
  }
}
