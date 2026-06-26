'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';

import { compactMarkdownComponents } from '../../components/markdown-utils';

type AttachmentChipShellProps = {
  ariaLabel: string;
  icon: ReactNode;
  /** Optional prefix label (e.g. sender role for message chips). */
  prefix?: ReactNode;
  displayText: string;
  firstLine: string;
  mode: 'editable' | 'view';
  onOpen: () => void;
  onRemove?: () => void;
};

/** Shared editable/view chip chrome for attachment types. */
export function AttachmentChipShell({
  ariaLabel,
  icon,
  prefix,
  displayText,
  firstLine,
  mode,
  onOpen,
  onRemove,
}: AttachmentChipShellProps) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-tertiary border border-chatroom-border text-xs group hover:border-chatroom-border-strong transition-colors">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 cursor-pointer focus:outline-none"
        aria-label={ariaLabel}
      >
        {icon}
        {prefix}
        <span
          className="text-chatroom-text-secondary truncate max-w-[150px] hover:text-chatroom-text-primary transition-colors text-[10px] font-bold uppercase tracking-wider"
          title={firstLine}
        >
          <Markdown components={compactMarkdownComponents}>{displayText}</Markdown>
        </span>
      </button>

      {mode === 'editable' && onRemove && (
        <button
          onClick={onRemove}
          className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors flex-shrink-0"
          aria-label="Remove attachment"
          type="button"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
