'use client';

import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface StandingInstructionsCreateNewButtonProps {
  selected: boolean;
  onSelect: () => void;
}

export function StandingInstructionsCreateNewButton({
  selected,
  onSelect,
}: StandingInstructionsCreateNewButtonProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="standing-instructions-create-new"
      className={cn(
        'w-full flex items-center justify-center gap-2 border-t border-chatroom-border px-3 py-2',
        'text-xs font-bold uppercase tracking-wider text-chatroom-text-primary',
        'hover:bg-chatroom-bg-hover transition-colors cursor-pointer',
        selected && 'bg-chatroom-bg-hover'
      )}
    >
      <Plus size={12} className="shrink-0" aria-hidden="true" />
      <span>Create new</span>
    </button>
  );
}
