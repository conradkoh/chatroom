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

export const ICON_SIZE = 10;

/**
 * Duration slot: fixed 7ch, so durations share one left x and the timestamp column never moves.
 * Values 8 characters or longer clip with an ellipsis (for example `100h 10m`); the full value stays
 * in the duration's `title`. font-mono text-[10px] is on this same element so `ch` = 6px. Rendered
 * for handoffs even when empty.
 */
export const TIMELINE_HANDOFF_DURATION_SLOT =
  'w-[7ch] shrink-0 truncate text-left font-mono text-[10px] tabular-nums';

/** Handoff timestamp: right-aligned so the time of day ends at a fixed x, 8px before the slot. May truncate only for a prior-year date below ~340px (full value stays in `title`). */
export const TIMELINE_HANDOFF_TIMESTAMP =
  'min-w-0 truncate text-right text-[10px] font-mono font-bold tabular-nums whitespace-nowrap text-chatroom-text-muted';

/** Timestamp for non-handoff footers. Byte-identical to the class string the timestamp used before this change. */
export const TIMELINE_FOOTER_TIMESTAMP =
  'text-[10px] font-mono font-bold tabular-nums whitespace-nowrap text-chatroom-text-muted';

/** Handoff footer root: 2 columns. Row 1 = controls | time row. Row 2 = agent line spanning both columns. */
export const TIMELINE_HANDOFF_FOOTER =
  'mt-2 pt-1.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5';
export const TIMELINE_HANDOFF_FOOTER_TIME_ROW =
  'flex min-w-0 items-center justify-end gap-2 whitespace-nowrap';
export const TIMELINE_HANDOFF_FOOTER_AGENT_ROW = 'col-span-2 flex min-w-0 justify-end empty:hidden';

/** Agent line: plain muted mono text with no background, padding or icon, so its right edge is flush with the duration slot. */
export const TIMELINE_AGENT_LINE =
  'inline-flex min-w-0 max-w-full items-center gap-1 whitespace-nowrap font-mono text-[10px] leading-4 text-chatroom-text-muted';
/** Harness segment: its own cap, never shrinks below it. */
export const TIMELINE_AGENT_HARNESS = 'shrink-0 truncate';
/** Model segment: takes the remainder of the line. */
export const TIMELINE_AGENT_MODEL = 'min-w-0 truncate';
/** The `·` separator. */
export const TIMELINE_AGENT_DOT = 'shrink-0';

/** Per-placement agent-line budgets: `footer` for the eager handoff footer and the details dialog footer, `bar` for the collapsed handoff bar meta. */
export const TIMELINE_AGENT_PLACEMENT = {
  footer: {
    line: '',
    harness: 'max-w-[14ch] sm:max-w-[20ch]',
    model: 'max-w-[40ch] sm:max-w-[65ch]',
  },
  bar: {
    line: 'max-sm:hidden sm:max-w-[44ch] md:max-w-[56ch]',
    harness: 'sm:max-w-[12ch] md:max-w-[16ch]',
    model: 'max-w-full',
  },
} as const;
export type SenderAgentPlacement = keyof typeof TIMELINE_AGENT_PLACEMENT;

export function getSenderClasses(role: string): string {
  const base = 'font-bold text-[10px] uppercase tracking-wide';
  if (role.toLowerCase() === 'user') {
    return `${base} text-amber-500 dark:text-amber-400 drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]`;
  }
  if (role === 'system') return `${base} text-chatroom-status-warning`;
  return `${base} text-chatroom-status-info`;
}

/** Full-width summary bar for collapsible handoff rows. It opens the details dialog, so the row height never changes. */
export const TIMELINE_HANDOFF_TRIGGER =
  'group/handoff-trigger flex w-full items-start gap-2 px-4 py-2 text-left cursor-pointer ' +
  'transition-[background-color,opacity] duration-100 motion-reduce:transition-none hover:bg-chatroom-bg-hover active:opacity-80 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-chatroom-accent';

/** Static 14px Maximize2 icon in the icon slot, centred on the first 20px text line. */
export const TIMELINE_HANDOFF_OPEN_ICON =
  'mt-[3px] shrink-0 text-chatroom-text-muted group-hover/handoff-trigger:text-chatroom-text-primary';

/** Collapsed preview text: the primary scan content of the row. */
export const TIMELINE_HANDOFF_PREVIEW_TEXT =
  'min-w-0 flex-1 line-clamp-2 [overflow-wrap:anywhere] text-sm leading-5 text-chatroom-text-secondary ' +
  'group-hover/handoff-trigger:text-chatroom-text-primary';

/** Empty-preview "Show full handoff" label. */
export const TIMELINE_HANDOFF_TRIGGER_LABEL =
  'min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wide leading-5 text-chatroom-text-muted ' +
  'group-hover/handoff-trigger:text-chatroom-text-primary';

/**
 * Collapsed bar meta column: two right-anchored lines, top-aligned with the first preview line.
 * Line 1 is the time row (timestamp + duration slot). Line 2 is the agent line, hidden below `sm`.
 * `max-w-[55%]` keeps the preview at least 45% of the bar width.
 */
export const TIMELINE_HANDOFF_META =
  'flex min-w-0 max-w-[55%] shrink-0 flex-col items-end leading-5';

/** Collapsed bar line 1: timestamp then the fixed duration slot, right-anchored, 20px tall. */
export const TIMELINE_HANDOFF_META_TIME_ROW =
  'flex h-5 items-center justify-end gap-2 whitespace-nowrap';

/**
 * Collapsed-row attachment chips. 38px (2.375rem) = 16px bar padding (px-4) + 14px
 * icon + 8px gap-2, so the chips line up with the preview text above them.
 */
export const TIMELINE_HANDOFF_CHIPS = 'pl-[2.375rem]';

/** 10px caps label used for plan-level and per-phase section labels. */
export const TIMELINE_PLAN_LABEL =
  'text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted';

/** Focus ring shared by plan links, copy controls and jump targets. */
export const TIMELINE_PLAN_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-chatroom-accent';

/** Copy / jump control chrome (icon-only or label+icon). */
export const TIMELINE_PLAN_CONTROL =
  'inline-flex items-center gap-1 text-chatroom-text-muted transition-colors motion-reduce:transition-none ' +
  'hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary ' +
  TIMELINE_PLAN_FOCUS;
