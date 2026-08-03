'use client';

import { standingInstructionDisplayTitle } from '@workspace/backend/src/domain/entities/standing-instructions';
import { Pencil, Trash2 } from 'lucide-react';

import { PickerOptionRow } from '../../../components/picker';

import { cn } from '@/lib/utils';

// fallow-ignore-next-line complexity
export function StandingInstructionsPickerRow({
  title,
  content,
  selected,
  showActiveBadge,
  onSelect,
  onEdit,
  onDelete,
  mobile,
  className,
}: {
  title: string;
  content: string;
  selected?: boolean;
  showActiveBadge?: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  mobile?: boolean;
  className?: string;
}) {
  const displayTitle = standingInstructionDisplayTitle({ title, content });
  const iconSize = mobile ? 14 : 12;
  const actionButtonBase = cn(
    'inline-flex items-center justify-center shrink-0 p-1.5',
    mobile ? 'min-h-8 min-w-8 touch-manipulation' : 'h-8 w-8'
  );
  const actionButtonClass = cn(
    actionButtonBase,
    'text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors'
  );
  const deleteButtonClass = cn(
    actionButtonBase,
    'text-chatroom-text-muted hover:text-chatroom-status-error transition-colors'
  );

  const trailingActions =
    onEdit || onDelete ? (
      <div
        className={cn('flex shrink-0 items-center self-center pr-2', mobile ? 'gap-1' : 'gap-0.5')}
      >
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit"
            title="Edit"
            className={actionButtonClass}
          >
            <Pencil size={iconSize} aria-hidden="true" />
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete"
            title="Delete"
            className={deleteButtonClass}
          >
            <Trash2 size={iconSize} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    ) : undefined;

  return (
    <PickerOptionRow
      multiline
      selected={selected}
      onSelect={onSelect}
      className={className}
      trailingActions={trailingActions}
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
        <span className="line-clamp-1 break-words font-medium">{displayTitle}</span>
        <span className="line-clamp-3 break-words text-chatroom-text-muted">{content}</span>
      </span>
    </PickerOptionRow>
  );
}
