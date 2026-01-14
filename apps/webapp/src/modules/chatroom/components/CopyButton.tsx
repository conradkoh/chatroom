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
      className={`copy-button ${copied ? 'copied' : ''} ${className}`}
      title={copied ? copiedLabel : `Copy ${label}`}
    >
      {copied ? (
        <>
          <span className="copy-icon">
            <Check size={14} />
          </span>
          {copiedLabel}
        </>
      ) : (
        <>
          <span className="copy-icon">
            <Clipboard size={14} />
          </span>
          {label}
        </>
      )}
    </button>
  );
}
