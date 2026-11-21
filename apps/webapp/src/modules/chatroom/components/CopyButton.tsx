'use client';

import { AlertCircle, Check, Clipboard } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const COPY_FAILED_MESSAGE = 'Failed to copy to clipboard';
const FLIP_MS = 2000;

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  /** Compact variant shows only icon */
  variant?: 'default' | 'compact';
  /**
   * Receives the failure message when the clipboard write is rejected, so the caller can show it
   * in its own slot. Without a sink the button shows an error icon for 2 s instead.
   */
  onCopyError?: (message: string) => void;
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied!',
  className = '',
  variant = 'default',
  onCopyError,
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flip = useCallback((next: Exclude<CopyState, 'idle'>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(next);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setState('idle');
    }, FLIP_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        if (onCopyError) onCopyError(COPY_FAILED_MESSAGE);
        else flip('failed');
        return;
      }
      flip('copied');
    },
    [text, onCopyError, flip]
  );

  const isCompact = variant === 'compact';
  const isCopied = state === 'copied';
  const isFailed = state === 'failed';

  const stateClasses = isCopied
    ? 'bg-chatroom-status-success/15 text-chatroom-status-success border-chatroom-status-success/30'
    : isFailed
      ? 'bg-chatroom-status-error/15 text-chatroom-status-error border-chatroom-status-error/30'
      : 'bg-transparent text-chatroom-text-secondary border-chatroom-border hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary';

  const sizeClasses = isCompact ? 'p-1.5' : 'px-3 py-1.5';
  const Icon = isCopied ? Check : isFailed ? AlertCircle : Clipboard;
  const title = isCopied ? copiedLabel : isFailed ? COPY_FAILED_MESSAGE : `Copy ${label}`;

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 ${sizeClasses} text-[10px] font-bold uppercase tracking-wide transition-all duration-100 border-2 cursor-pointer ${stateClasses} ${className}`}
      title={title}
    >
      <Icon size={14} />
      {!isCompact && (isCopied ? copiedLabel : label)}
    </button>
  );
}
