'use client';

import { wantsStandingConfirm } from './standingInstructionsEditorUtils';
import { chatroomIndustrialInputClassName } from '../../../components/shared/industrialDialogStyles';

import { cn } from '@/lib/utils';

export interface StandingInstructionsTitleInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired on Cmd/Ctrl+Enter (no Escape cancel on the title field). */
  onCmdEnter?: () => void;
}

export function StandingInstructionsTitleInput({
  value,
  onChange,
  onCmdEnter,
}: StandingInstructionsTitleInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (onCmdEnter && wantsStandingConfirm(e)) {
          e.preventDefault();
          onCmdEnter();
        }
      }}
      placeholder="Title"
      maxLength={120}
      required
      aria-required="true"
      className={cn('h-9 w-full px-3 text-sm', chatroomIndustrialInputClassName)}
    />
  );
}
