'use client';

import { useIsDesktop } from '@/hooks/useIsDesktop';
import { cn } from '@/lib/utils';

export interface PickerSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** When undefined, focuses on desktop only. Explicit true/false overrides on any platform. */
  autoFocus?: boolean;
  className?: string;
}

export function PickerSearch({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus,
  className,
}: PickerSearchProps) {
  const isDesktop = useIsDesktop();
  const shouldAutoFocus = autoFocus ?? isDesktop;

  return (
    <div className={cn('px-3 py-1.5 border-b border-chatroom-border', className)}>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={shouldAutoFocus}
        className="w-full bg-chatroom-bg-tertiary border border-chatroom-border px-2 py-1 text-[11px] text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent rounded-none"
      />
    </div>
  );
}
