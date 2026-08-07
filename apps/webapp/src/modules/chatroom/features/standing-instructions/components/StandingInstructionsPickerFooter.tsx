'use client';

import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
  chatroomIndustrialDialogFooterClassName,
} from '../../../components/shared/industrialDialogStyles';
import { ChatroomDestructiveTextButton } from '../../../components/ui/ChatroomDestructiveTextButton';

import { cn } from '@/lib/utils';

// fallow-ignore-next-line complexity
export function StandingInstructionsPickerFooter({
  isActive,
  hasContent,
  selectedId,
  activeId,
  onDisable,
  onEnable,
  onApply,
}: {
  isActive: boolean;
  hasContent: boolean;
  selectedId: string | null;
  activeId: string | null;
  onDisable: () => void;
  onEnable: () => void;
  onApply: () => void;
}) {
  const showUpdate = isActive && selectedId !== null && selectedId !== activeId;
  const showApply = !isActive && selectedId !== null;
  const showDisable = isActive;
  const showEnable = !isActive && hasContent && selectedId === null;

  const primaryLabel = isActive ? 'Update' : 'Apply';
  const primaryDisabled = !showUpdate && !showApply;

  return (
    <div className={cn(chatroomIndustrialDialogFooterClassName, 'sm:justify-between shrink-0')}>
      <div className="flex gap-2">
        {showDisable ? (
          <ChatroomDestructiveTextButton size="industrial" onClick={onDisable}>
            Disable
          </ChatroomDestructiveTextButton>
        ) : null}
        {showEnable ? (
          <button
            type="button"
            onClick={onEnable}
            className={chatroomIndustrialButtonSecondaryClassName}
          >
            Enable
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onApply}
        disabled={primaryDisabled}
        className={cn(
          chatroomIndustrialButtonPrimaryClassName,
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {primaryLabel}
      </button>
    </div>
  );
}
