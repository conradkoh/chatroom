'use client';

import { Check, Copy } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface FileContentActionBarProps {
  copyLabel: string;
  onCopy: () => void;
  disabled?: boolean;
  /** Shows a check icon instead of the copy icon for the 2 s success window. */
  copied?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function FileContentActionBar({
  copyLabel,
  onCopy,
  disabled = false,
  copied = false,
  leading,
  trailing,
  className,
}: FileContentActionBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-1.5 border-b border-chatroom-border shrink-0',
        className
      )}
    >
      {leading}
      <div className="flex-1" />
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors cursor-pointer',
          'text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover',
          'disabled:opacity-50 disabled:pointer-events-none'
        )}
        onClick={onCopy}
        disabled={disabled}
        title={copyLabel}
        aria-label={copyLabel}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        Copy
      </button>
      {trailing}
    </div>
  );
}
