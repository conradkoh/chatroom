'use client';

import {
  usePickerSearchState,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  PickerPanelHeader,
  filterPickerItems,
} from '../../../components/picker';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

export interface StandingInstructionsHistoryPickerViewProps {
  items: StandingInstructionHistoryItem[];
  onSelect: (item: StandingInstructionHistoryItem) => void;
  onBack?: () => void;
}

export function StandingInstructionsHistoryPickerView({
  items,
  onSelect,
}: StandingInstructionsHistoryPickerViewProps) {
  const { searchTerm, setSearchTerm } = usePickerSearchState(() => {});
  const filtered = filterPickerItems(items, searchTerm, (item) => item.content);

  return (
    <>
      <PickerPanelHeader title="Standing instruction history" />
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search history…" />
      <PickerScrollBody>
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-chatroom-text-muted">No matches</div>
        ) : (
          filtered.map((item) => (
            <PickerOptionRow
              key={item.id}
              selected={false}
              onSelect={() => {
                onSelect(item);
              }}
            >
              {item.content}
            </PickerOptionRow>
          ))
        )}
      </PickerScrollBody>
    </>
  );
}
