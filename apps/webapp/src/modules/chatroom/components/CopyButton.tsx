'use client';

import { Check, Clipboard } from 'lucide-react';
import React, { useState, useCallback } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  /** Compact variant shows only icon */
  variant?: 'default' | 'compact';
}

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied!',
  className = '',
  variant = 'default',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  const isCompact = variant === 'compact';

  const baseClasses = copied
    ? 'bg-chatroom-status-success/15 text-chatroom-status-success border-chatroom-status-success/30'
    : 'bg-transparent text-chatroom-text-secondary border-chatroom-border hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary';

  const sizeClasses = isCompact ? 'p-1.5' : 'px-3 py-1.5';

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 ${sizeClasses} text-[10px] font-bold uppercase tracking-wide transition-all duration-100 border-2 cursor-pointer ${baseClasses} ${className}`}
      title={copied ? copiedLabel : `Copy ${label}`}
    >
      {copied ? (
        <>
          <Check size={14} />
          {!isCompact && copiedLabel}
        </>
      ) : (
        <>
          <Clipboard size={14} />
          {!isCompact && label}
        </>
      )}
    </button>
  );
}
