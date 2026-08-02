'use client';

import { standingInstructionDisplayTitle } from '@workspace/backend/src/domain/entities/standing-instructions';
import { Trash2 } from 'lucide-react';

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
  onDeletePreset?: (historyId: string) => void;
  onBack?: () => void;
}

export function StandingInstructionsHistoryPickerView({
  items,
  onSelect,
  onDeletePreset,
}: StandingInstructionsHistoryPickerViewProps) {
  const { searchTerm, setSearchTerm } = usePickerSearchState(() => {});
  const filtered = filterPickerItems(items, searchTerm, (item) =>
    `${item.title} ${item.content}`.trim()
  );

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
              <span className="flex-1 min-w-0 truncate">
                {standingInstructionDisplayTitle({ title: item.title, content: item.content })}
              </span>
              {onDeletePreset ? (
                <button
                  type="button"
                  data-testid={`standing-instructions-delete-preset-${item.id}`}
                  aria-label={`Delete preset ${item.title || 'untitled'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeletePreset(item.id);
                  }}
                  className="shrink-0 p-1 text-chatroom-text-muted hover:text-destructive transition-colors"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              ) : null}
            </PickerOptionRow>
          ))
        )}
      </PickerScrollBody>
    </>
  );
}
