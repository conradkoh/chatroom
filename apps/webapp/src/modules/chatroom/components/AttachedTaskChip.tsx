'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Paperclip, X } from 'lucide-react';
import React, { useState } from 'react';
import Markdown from 'react-markdown';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { baseMarkdownComponents, compactMarkdownComponents } from './markdown-utils';

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
 * Displays a single attached task as a removable chip.
 * Click the chip label to open a full-content modal.
 * Renders minimal markdown in both the chip and the modal.
 */
export function AttachedTaskChip({ content, onRemove }: AttachedTaskChipProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get first line only for chip label
  const firstLine = content.split('\n')[0] || content;
  const displayText = truncateText(firstLine);

  return (
    <>
      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-tertiary border border-chatroom-border text-xs group hover:border-chatroom-border-strong transition-colors">
        {/* Clickable label area */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1.5 cursor-pointer focus:outline-none"
          aria-label="View attached task"
        >
          <Paperclip size={12} className="text-chatroom-text-muted flex-shrink-0" />
          <span
            className="text-chatroom-text-secondary truncate max-w-[150px] hover:text-chatroom-text-primary transition-colors"
            title={firstLine}
          >
            <Markdown components={compactMarkdownComponents}>{displayText}</Markdown>
          </span>
        </button>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover rounded-sm transition-colors flex-shrink-0"
          aria-label="Remove attachment"
          type="button"
        >
          <X size={12} />
        </button>
      </div>

      {/* Full-content modal */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-foreground">
              Attached Task
            </DialogTitle>
          </DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
            <Markdown components={baseMarkdownComponents}>{content}</Markdown>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
