'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Paperclip, X } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import Markdown from 'react-markdown';

import { compactMarkdownComponents } from './markdown-utils';

interface AttachedTaskChipProps {
  taskId: Id<'chatroom_tasks'>;
  content: string;
  onRemove: () => void;
}

/**
 * Truncate text to a maximum length with ellipsis.
 */
function truncateText(text: string, maxLength = 30): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

/**
 * Strip leading markdown heading syntax (# characters) from a line.
 * e.g. "## My Task" → "My Task"
 */
function stripMarkdownHeading(line: string): string {
  return line.replace(/^#+\s*/, '');
}

/**
 * Displays a single attached task as a removable chip.
 * Click the chip label to open a themed slide-in panel showing the full content.
 * Renders minimal markdown in the chip; full markdown in the panel.
 */
export function AttachedTaskChip({ content, onRemove }: AttachedTaskChipProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Get first non-empty line for chip label, stripping markdown heading syntax
  const rawFirstLine = content.split('\n').find((line) => line.trim()) || content;
  const firstLine = stripMarkdownHeading(rawFirstLine);
  const displayText = truncateText(firstLine);

  return (
    <>
      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-tertiary border border-chatroom-border text-xs group hover:border-chatroom-border-strong transition-colors">
        {/* Clickable label */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1.5 cursor-pointer focus:outline-none"
          aria-label="View attached task"
        >
          <Paperclip size={12} className="text-chatroom-text-muted flex-shrink-0" />
          <span
            className="text-chatroom-text-secondary truncate max-w-[150px] hover:text-chatroom-text-primary transition-colors text-[10px] font-bold uppercase tracking-wider"
            title={firstLine}
          >
            <Markdown components={compactMarkdownComponents}>{displayText}</Markdown>
          </span>
        </button>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors flex-shrink-0"
          aria-label="Remove attachment"
          type="button"
        >
          <X size={12} />
        </button>
      </div>

      {/* Centered modal */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          {/* Modal */}
          <div
            className="chatroom-root fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-2xl md:max-h-[85vh] lg:max-w-4xl lg:max-h-[90vh] lg:w-[90%] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-[70] flex flex-col animate-in fade-in zoom-in-95 duration-200"
            aria-modal="true"
            role="dialog"
            aria-label="Attached task content"
          >
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-tertiary flex-shrink-0">
              <div className="flex items-center gap-2">
                <Paperclip size={14} className="text-chatroom-text-muted" />
                <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
                  Attached Task
                </span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
                aria-label="Close panel"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-chatroom-text-primary prose-p:my-2 prose-p:text-chatroom-text-primary prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary prose-code:text-chatroom-text-primary prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-li:text-chatroom-text-primary prose-pre:bg-chatroom-bg-tertiary prose-pre:border prose-pre:border-chatroom-border prose-pre:rounded-none">
                <Markdown>{content}</Markdown>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
