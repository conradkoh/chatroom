'use client';

import { ArrowUpToLine } from 'lucide-react';

import {
  JUMP_TO_NEW_MESSAGES_GAP_PX,
  JUMP_TO_NEW_MESSAGES_Z_INDEX,
} from '../../components/timeline/timelineVirtualizerConfig';

/**
 * Icon-only floating "Jump to top" control. Presentation only: visibility, timing and
 * the actual scroll live in `useJumpToTop`. Shares the jump-to-new-messages chip's gap
 * and z-index so both overlays sit on the same layer without stacking.
 */
export function ConversationJumpToTopButton({
  onClick,
  onPause,
  onResume,
}: {
  onClick: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
      style={{ bottom: JUMP_TO_NEW_MESSAGES_GAP_PX, zIndex: JUMP_TO_NEW_MESSAGES_Z_INDEX }}
      className="absolute right-3 md:right-4 flex h-10 w-10 md:h-9 md:w-9 items-center justify-center bg-chatroom-accent text-chatroom-text-on-accent shadow-lg transition-colors hover:bg-chatroom-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chatroom-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-chatroom-bg-primary animate-in fade-in duration-150 motion-reduce:animate-none"
      aria-label="Jump to top"
      title="Jump to top"
      data-testid="conversation-jump-to-top"
    >
      <ArrowUpToLine size={16} aria-hidden="true" />
    </button>
  );
}
