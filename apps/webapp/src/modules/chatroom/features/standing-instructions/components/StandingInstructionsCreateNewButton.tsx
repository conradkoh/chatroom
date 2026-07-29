'use client';

import { Plus } from 'lucide-react';

export interface StandingInstructionsCreateNewButtonProps {
  selected: boolean;
  onSelect: () => void;
  mobile?: boolean;
}

export function StandingInstructionsCreateNewButton({
  selected,
  onSelect,
  mobile,
}: StandingInstructionsCreateNewButtonProps) {
  const baseClasses =
    'w-full flex items-center justify-center gap-2 font-bold uppercase tracking-wider border-0 transition-colors cursor-pointer';
  const sizeClasses = mobile ? 'min-h-11 px-3 py-2 text-sm' : 'px-4 py-2 text-xs';
  const stateClasses = selected
    ? 'bg-chatroom-status-success/10 text-chatroom-accent'
    : 'bg-chatroom-status-success/5 text-chatroom-text-primary hover:bg-chatroom-status-success/10';

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="standing-instructions-create-new"
      className={`${baseClasses} ${sizeClasses} ${stateClasses}`}
    >
      <Plus size={mobile ? 14 : 12} className="shrink-0" aria-hidden="true" />
      <span>Create new</span>
    </button>
  );
}
