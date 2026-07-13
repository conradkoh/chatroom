'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PickerOptionRowProps {
  children: React.ReactNode;
  selected?: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

export function PickerOptionRow({ children, selected, onSelect, disabled }: PickerOptionRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected ?? false}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'w-full px-3 py-2 text-xs text-left flex items-center justify-between gap-2',
        'hover:bg-chatroom-bg-hover transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        selected && 'bg-chatroom-bg-hover'
      )}
    >
      <span className="truncate">{children}</span>
      {selected ? <Check size={12} className="shrink-0 text-chatroom-accent" /> : null}
    </button>
  );
}
