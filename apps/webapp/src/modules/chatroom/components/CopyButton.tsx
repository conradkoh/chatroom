'use client';

import { Check, Clipboard } from 'lucide-react';
import React, { useState, useCallback } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied!',
  className = '',
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

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-all duration-100 border-2 cursor-pointer ${
        copied
          ? 'bg-emerald-400/15 text-chatroom-status-success border-emerald-400/30'
          : 'bg-transparent text-chatroom-text-secondary border-chatroom-border hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary'
      } ${className}`}
      title={copied ? copiedLabel : `Copy ${label}`}
    >
      {copied ? (
        <>
          <Check size={14} />
          {copiedLabel}
        </>
      ) : (
        <>
          <Clipboard size={14} />
          {label}
        </>
      )}
    </button>
  );
}
