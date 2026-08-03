'use client';

import { standingInstructionDisplayTitle } from '@workspace/backend/src/domain/entities/standing-instructions';

import { PickerOptionRow } from '../../../components/picker';

export function StandingInstructionsPickerRow({
  title,
  content,
  selected,
  showActiveBadge,
  onSelect,
  className,
}: {
  title: string;
  content: string;
  selected?: boolean;
  showActiveBadge?: boolean;
  onSelect: () => void;
  className?: string;
}) {
  const displayTitle = standingInstructionDisplayTitle({ title, content });
  return (
    <PickerOptionRow
      selected={selected}
      onSelect={onSelect}
      className={className}
      endAdornment={
        showActiveBadge ? (
          <span
            data-testid="picker-row-end-adornment"
            className="shrink-0 text-[10px] uppercase text-chatroom-status-success"
          >
            Active
          </span>
        ) : undefined
      }
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate font-medium">{displayTitle}</span>
        <span className="truncate text-chatroom-text-muted">{content}</span>
      </span>
    </PickerOptionRow>
  );
}
