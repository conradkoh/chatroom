'use client';

import { StandingInstructionsCreateNewButton } from './StandingInstructionsCreateNewButton';
import { StandingInstructionsPickerRow } from './StandingInstructionsPickerRow';
import type { PickerListItem } from './standingInstructionsPickerUtils';
import { PickerPanelHeader } from '../../../components/picker';

export function StandingInstructionsPickerContent({
  visible,
  activeId,
  selectedId,
  hasMore,
  onSelect,
  onViewMore,
  onCreateNew,
  mobile,
}: {
  visible: PickerListItem[];
  activeId: string | null;
  selectedId: string | null;
  hasMore: boolean;
  onSelect: (id: string) => void;
  onViewMore: () => void;
  onCreateNew: () => void;
  mobile?: boolean;
}) {
  return (
    <>
      <PickerPanelHeader title="Standing instructions">
        {hasMore ? (
          <button
            type="button"
            onClick={onViewMore}
            data-testid="standing-instructions-view-more"
            className="text-[10px] font-bold uppercase tracking-wider text-chatroom-accent hover:opacity-80 cursor-pointer shrink-0"
          >
            View more
          </button>
        ) : null}
      </PickerPanelHeader>
      <ul className="flex w-full flex-col border border-chatroom-border divide-y divide-chatroom-border">
        {visible.map((item) => (
          <li key={item.id}>
            <StandingInstructionsPickerRow
              title={item.title}
              content={item.content}
              selected={item.id === selectedId}
              showActiveBadge={item.id === activeId}
              onSelect={() => onSelect(item.id)}
              className="rounded-none"
            />
          </li>
        ))}
      </ul>
      <StandingInstructionsCreateNewButton
        selected={false}
        onSelect={onCreateNew}
        mobile={mobile}
      />
    </>
  );
}
