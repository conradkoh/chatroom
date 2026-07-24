'use client';

import { cn } from '@/lib/utils';

export interface ModelFilterProviderHeaderProps {
  providerLabel: string;
  isProviderHidden: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function ModelFilterProviderHeader({
  providerLabel,
  isProviderHidden,
  disabled = false,
  onToggle,
}: ModelFilterProviderHeaderProps) {
  return (
    <div className="px-3 py-1.5 border-b border-chatroom-border flex items-center justify-between bg-chatroom-bg-tertiary">
      <span
        className={cn(
          'text-[10px] font-bold uppercase tracking-wider',
          isProviderHidden ? 'text-chatroom-text-muted opacity-60' : 'text-chatroom-text-secondary'
        )}
      >
        {providerLabel}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
          isProviderHidden
            ? 'border-chatroom-status-warning text-chatroom-status-warning hover:border-chatroom-status-warning/80 hover:text-chatroom-status-warning/80'
            : 'border-chatroom-border text-chatroom-text-muted hover:text-chatroom-text-primary hover:border-chatroom-border-strong'
        )}
      >
        {isProviderHidden ? 'Show All' : 'Hide All'}
      </button>
    </div>
  );
}
