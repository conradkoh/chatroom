'use client';

import { chatroomIndustrialInputClassName } from '../../../components/shared/industrialDialogStyles';

import { cn } from '@/lib/utils';

export interface StandingInstructionsTitleInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function StandingInstructionsTitleInput({
  value,
  onChange,
}: StandingInstructionsTitleInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Title"
      maxLength={120}
      required
      aria-required="true"
      className={cn('h-9 w-full px-3 text-sm', chatroomIndustrialInputClassName)}
    />
  );
}
