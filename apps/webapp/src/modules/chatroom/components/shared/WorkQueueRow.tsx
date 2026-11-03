'use client';

import type { ReactNode } from 'react';

export interface WorkQueueRowProps {
  /** Primary text (for queued: `<WorkQueuePreviewText/>`). */
  preview: ReactNode;
  /** Secondary line (queued: elapsed time). Omit to render nothing. */
  meta?: ReactNode;
  /** Attachment chips strip. Rendered inside a click-isolating wrapper. Omit when empty. */
  attachments?: ReactNode;
  /** Trailing controls (envelope buttons + delete). Rendered inside a click-isolating wrapper. */
  actions: ReactNode;
  /** Called on row click, Enter, or Space (not from the actions or attachments). */
  onOpen: () => void;
}

function stopPropagation(e: { stopPropagation: () => void }) {
  e.stopPropagation();
}

/**
 * Shared two-column sidebar row for work-queue lists. Purely structural: it
 * takes nodes plus `onOpen` and knows nothing about queued or scheduled data.
 * Clicks inside the actions and attachment strips are isolated from the row.
 */
export function WorkQueueRow({ preview, meta, attachments, actions, onOpen }: WorkQueueRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors cursor-pointer text-left w-full"
    >
      <div className="flex-1 min-w-0">
        {preview}
        {meta !== undefined && <p className="text-[10px] text-muted-foreground mt-0.5">{meta}</p>}
        {attachments !== undefined && (
          <div className="flex flex-wrap gap-1.5 mt-1" onClick={stopPropagation}>
            {attachments}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1" onClick={stopPropagation}>
        {actions}
      </div>
    </div>
  );
}
