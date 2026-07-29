'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export function AllTabAnchorNavigator({
  contentPreview,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  contentPreview: string | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 py-2 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface"
      data-testid="all-tab-anchor-navigator"
    >
      <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label="Previous user message">
        <ChevronLeft size={18} />
      </button>
      <span className="flex-1 truncate text-xs text-chatroom-text-muted">
        {contentPreview ?? 'No user messages'}
      </span>
      <button type="button" onClick={onNext} disabled={!hasNext} aria-label="Next user message">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
