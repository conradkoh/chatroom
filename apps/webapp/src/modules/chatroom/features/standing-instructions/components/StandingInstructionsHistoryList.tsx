'use client';

import { standingInstructionDisplayTitle } from '@workspace/backend/src/domain/entities/standing-instructions';

import { PickerOptionRow } from '../../../components/picker';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';
import type { StandingInstructionsAddSelection } from '../types/standingInstructionsDialog';

export interface StandingInstructionsHistoryListProps {
  items: StandingInstructionHistoryItem[];
  selection: StandingInstructionsAddSelection;
  onSelect: (item: StandingInstructionHistoryItem) => void;
}

export function StandingInstructionsHistoryList({
  items,
  selection,
  onSelect,
}: StandingInstructionsHistoryListProps) {
  if (items.length === 0) return null;

  return (
    <ul className="flex w-full flex-col border border-chatroom-border divide-y divide-chatroom-border">
      {items.map((item) => (
        <li key={item.id}>
          <PickerOptionRow
            selected={selection === item.id}
            onSelect={() => onSelect(item)}
            className="rounded-none"
          >
            {standingInstructionDisplayTitle({ title: item.title, content: item.content })}
          </PickerOptionRow>
        </li>
      ))}
    </ul>
  );
}
