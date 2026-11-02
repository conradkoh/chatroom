/** Shared row chrome for timeline cells. */
export const TIMELINE_ROW_BORDER = 'border-b-2 border-chatroom-border';

/** Row root — establishes an isolated stacking context for sticky header vs body. */
export const TIMELINE_ROW_ROOT = 'relative isolate';

/** Message body — stays below the sticky header within the row. */
export const TIMELINE_MESSAGE_BODY = 'relative z-0';

/** Sticky header — width constrained to content lane left of scrollbar. */
export const TIMELINE_MESSAGE_HEADER_STICKY =
  'sticky top-0 z-10 bg-chatroom-bg-primary border-b border-chatroom-border ' +
  'w-[calc(100%-var(--timeline-scrollbar-width,0px))]';

/** Virtual-row z-index so later rows stack above earlier sticky headers. 1-based. */
export function getTimelineVirtualRowZIndex(index: number): number {
  return index + 1;
}

/** Width reserved for the scrollbar lane on timeline scroll containers. */
// fallow-ignore-next-line unused-export
export const TIMELINE_SCROLLBAR_WIDTH_PX = '8px';

/** CSS variable name — set on scroll containers, inherited by sticky headers. */
// fallow-ignore-next-line unused-export
export const TIMELINE_SCROLLBAR_WIDTH_VAR = '--timeline-scrollbar-width';

/** Inline style for scroll containers — sets inherited scrollbar width variable. */
export const TIMELINE_SCROLL_CONTAINER_STYLE: Record<string, string> = {
  [TIMELINE_SCROLLBAR_WIDTH_VAR]: TIMELINE_SCROLLBAR_WIDTH_PX,
};

/**
 * Base classes for the element that actually scrolls message content.
 * Requires flex parent with bounded height; pair with flex-1 on the element.
 */
export const TIMELINE_SCROLL_CONTAINER =
  'min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] ' +
  '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-chatroom-border ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-chatroom-bg-primary';

export const BADGE_BASE =
  'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5';

/**
 * Sticky-header message navigation (conversation feed): jump to first, previous,
 * current, next, or last message row. `has*` flags drive disabled state.
 */
export type TimelineMessageHeaderNavigation = {
  onJumpToFirst: () => void;
  onJumpToPrevious: () => void;
  onJumpToCurrent: () => void;
  onJumpToNext: () => void;
  onJumpToLast: () => void;
  hasFirst: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  hasLast: boolean;
};

export const ICON_SIZE = 10;

export function getSenderClasses(role: string): string {
  const base = 'font-bold text-[10px] uppercase tracking-wide';
  if (role.toLowerCase() === 'user') {
    return `${base} text-amber-500 dark:text-amber-400 drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]`;
  }
  if (role === 'system') return `${base} text-chatroom-status-warning`;
  return `${base} text-chatroom-status-info`;
}

/** Full-width disclosure bar for collapsible handoff rows. Identical padding in both states keeps the chevron fixed. */
export const TIMELINE_HANDOFF_TOGGLE =
  'group/handoff-toggle flex w-full items-start gap-2 px-4 py-2 text-left cursor-pointer ' +
  'transition-[background-color,opacity] duration-100 hover:bg-chatroom-bg-hover active:opacity-80 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-chatroom-accent';

/** Chevron: 14px icon centred on the first 20px text line; rotates 90° when expanded. */
export const TIMELINE_HANDOFF_CHEVRON =
  'mt-[3px] shrink-0 text-chatroom-text-muted transition-transform duration-150 motion-reduce:transition-none ' +
  'group-hover/handoff-toggle:text-chatroom-text-primary';

/** Collapsed preview text: the primary scan content of the row. */
export const TIMELINE_HANDOFF_PREVIEW_TEXT =
  'min-w-0 flex-1 line-clamp-2 [overflow-wrap:anywhere] text-sm leading-5 text-chatroom-text-secondary ' +
  'group-hover/handoff-toggle:text-chatroom-text-primary';

/** "Collapse" and empty-preview "Show full handoff" label. */
export const TIMELINE_HANDOFF_TOGGLE_LABEL =
  'min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wide leading-5 text-chatroom-text-muted ' +
  'group-hover/handoff-toggle:text-chatroom-text-primary';

/** Right-aligned time column inside the collapsed bar. */
export const TIMELINE_HANDOFF_META = 'flex shrink-0 items-center gap-1.5 leading-5';

/**
 * Collapsed-row attachment chips. 38px (2.375rem) = 16px bar padding (px-4) + 14px
 * chevron + 8px gap-2, so the chips line up with the preview text above them.
 */
export const TIMELINE_HANDOFF_CHIPS = 'pl-[2.375rem]';
