'use client';

import { cn } from '@/lib/utils';

export interface PickerSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function PickerSearch({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus = true,
  className,
}: PickerSearchProps) {
  return (
    <div className={cn('px-3 py-1.5 border-b border-chatroom-border', className)}>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-chatroom-bg-tertiary border border-chatroom-border px-2 py-1 text-[11px] text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent rounded-none"
      />
    </div>
  );
}
