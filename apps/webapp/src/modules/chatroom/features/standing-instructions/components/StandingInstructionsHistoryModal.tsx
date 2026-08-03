'use client';

import { StandingInstructionsPickerRow } from './StandingInstructionsPickerRow';
import {
  filterPickerItems,
  PickerSearch,
  PickerScrollBody,
  usePickerSearchState,
} from '../../../components/picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

export function StandingInstructionsHistoryModal({
  open,
  onOpenChange,
  history,
  onSelect,
  onEditItem,
  onDeleteItem,
  mobile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: StandingInstructionHistoryItem[];
  onSelect: (item: StandingInstructionHistoryItem) => void;
  onEditItem: (item: StandingInstructionHistoryItem) => void;
  onDeleteItem: (item: StandingInstructionHistoryItem) => void;
  mobile?: boolean;
}) {
  const { searchTerm, setSearchTerm } = usePickerSearchState(() => {});
  const filtered = filterPickerItems(history, searchTerm, (item) =>
    `${item.title} ${item.content}`.trim()
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent floating className="sm:max-w-md max-h-[min(90dvh,100%)]">
        <DialogHeader>
          <DialogTitle>Standing instruction history</DialogTitle>
        </DialogHeader>
        <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search history…" />
        <PickerScrollBody>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-chatroom-text-muted">No matches</div>
          ) : (
            <ul className="flex w-full flex-col divide-y divide-chatroom-border">
              {filtered.map((item) => (
                <li key={item.id}>
                  <StandingInstructionsPickerRow
                    title={item.title}
                    content={item.content}
                    onSelect={() => onSelect(item)}
                    onEdit={() => onEditItem(item)}
                    onDelete={() => onDeleteItem(item)}
                    mobile={mobile}
                    className="rounded-none"
                  />
                </li>
              ))}
            </ul>
          )}
        </PickerScrollBody>
      </DialogContent>
    </Dialog>
  );
}
