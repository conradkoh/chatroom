'use client';

import { ChevronDown, ChevronUp, CircleDot } from 'lucide-react';

import type { TimelineMessageHeaderNavigation } from './timelineRowStyles';

const NAV_BTN =
  'inline-flex items-center justify-center h-6 w-6 rounded text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-30 disabled:pointer-events-none transition-colors';

export function TimelineMessageHeaderNav({
  onJumpToPrevious,
  onJumpToCurrent,
  onJumpToNext,
  hasPrevious,
  hasNext,
}: TimelineMessageHeaderNavigation) {
  return (
    <div
      className="flex items-center gap-0.5"
      data-testid="timeline-message-header-nav"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={NAV_BTN}
        aria-label="Jump to previous message top"
        data-testid="timeline-header-nav-previous"
        disabled={!hasPrevious}
        onClick={onJumpToPrevious}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className={NAV_BTN}
        aria-label="Jump to current message top"
        data-testid="timeline-header-nav-current"
        onClick={onJumpToCurrent}
      >
        <CircleDot size={14} />
      </button>
      <button
        type="button"
        className={NAV_BTN}
        aria-label="Jump to next message top"
        data-testid="timeline-header-nav-next"
        disabled={!hasNext}
        onClick={onJumpToNext}
      >
        <ChevronDown size={14} />
      </button>
    </div>
  );
}
