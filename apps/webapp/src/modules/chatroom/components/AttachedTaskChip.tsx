'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Paperclip, X } from 'lucide-react';
import React from 'react';

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
 */
export function AttachedTaskChip({ content, onRemove }: AttachedTaskChipProps) {
  // Get first line only for display
  const firstLine = content.split('\n')[0] || content;
  const displayText = truncateText(firstLine);

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-tertiary border border-chatroom-border text-xs group hover:border-chatroom-border-strong transition-colors">
      <Paperclip size={12} className="text-chatroom-text-muted flex-shrink-0" />
      <span className="text-chatroom-text-secondary truncate max-w-[150px]" title={firstLine}>
        {displayText}
      </span>
      <button
        onClick={onRemove}
        className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover rounded-sm transition-colors flex-shrink-0"
        aria-label="Remove attachment"
        type="button"
      >
        <X size={12} />
      </button>
    </div>
  );
}
