'use client';

import { StandingInstructionsCreateNewButton } from './StandingInstructionsCreateNewButton';
import { StandingInstructionsPickerRow } from './StandingInstructionsPickerRow';
import { isSyntheticCurrentItem, type PickerListItem } from './standingInstructionsPickerUtils';

export function StandingInstructionsPickerContent({
  visible,
  activeId,
  selectedId,
  onSelect,
  onCreateNew,
  onEditItem,
  onDeleteItem,
  mobile,
}: {
  visible: PickerListItem[];
  activeId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
  onEditItem: (item: PickerListItem) => void;
  onDeleteItem: (item: PickerListItem) => void;
  mobile?: boolean;
}) {
  return (
    <>
      <ul className="flex w-full flex-col divide-y divide-chatroom-border">
        {visible.map((item) => (
          <li key={item.id}>
            <StandingInstructionsPickerRow
              title={item.title}
              content={item.content}
              selected={item.id === selectedId}
              showActiveBadge={item.id === activeId}
              onSelect={() => onSelect(item.id)}
              onEdit={() => onEditItem(item)}
              onDelete={isSyntheticCurrentItem(item) ? undefined : () => onDeleteItem(item)}
              mobile={mobile}
              className="rounded-none"
            />
          </li>
        ))}
      </ul>
      <StandingInstructionsCreateNewButton selected={false} onSelect={onCreateNew} />
    </>
  );
}
