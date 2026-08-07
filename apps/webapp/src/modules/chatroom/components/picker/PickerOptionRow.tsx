'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface PickerOptionRowProps {
  children: React.ReactNode;
  selected?: boolean;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
  endAdornment?: React.ReactNode;
  trailingActions?: React.ReactNode;
  multiline?: boolean;
}

// fallow-ignore-next-line complexity
export function PickerOptionRow({
  children,
  selected,
  onSelect,
  disabled,
  className,
  endAdornment,
  trailingActions,
  multiline = false,
}: PickerOptionRowProps) {
  const buttonClasses = cn(
    'min-w-0 px-3 py-2 text-xs text-left flex justify-between gap-2',
    multiline ? 'items-start' : 'items-center',
    'cursor-pointer hover:bg-chatroom-bg-hover transition-colors',
    'outline-none focus-visible:outline-none focus-visible:bg-chatroom-bg-hover',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    selected && 'bg-chatroom-bg-hover',
    trailingActions ? 'flex-1 rounded-none' : 'w-full',
    !trailingActions && className
  );

  const button = (
    <button
      type="button"
      role="option"
      aria-selected={selected ?? false}
      disabled={disabled}
      onClick={onSelect}
      className={buttonClasses}
    >
      <span className={cn('min-w-0 flex-1', multiline ? 'overflow-hidden' : 'truncate')}>
        {children}
      </span>
      {endAdornment}
      {selected && !trailingActions ? (
        <Check size={12} className="shrink-0 text-chatroom-accent" />
      ) : null}
    </button>
  );

  if (!trailingActions) return button;

  return (
    <div className={cn('flex items-center w-full min-w-0', className)}>
      {button}
      {trailingActions}
    </div>
  );
}
