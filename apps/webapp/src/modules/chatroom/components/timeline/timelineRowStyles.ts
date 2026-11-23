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

/**
 * Collapsed bar duration slot: the shared 7ch slot, but unclipped and auto width below `sm` so the full
 * value (for example `100h 10m`) shows on the stacked meta row. The expanded footer keeps the plain
 * TIMELINE_HANDOFF_DURATION_SLOT.
 */
export const TIMELINE_HANDOFF_META_DURATION_SLOT =
  TIMELINE_HANDOFF_DURATION_SLOT + ' max-sm:w-auto max-sm:overflow-visible';

/**
 * Handoff timestamp. The time of day ends at a fixed x because its time row is `justify-end` and
 * the duration slot after it has a fixed width; no text alignment is needed. Truncates only for a
 * prior-year date at narrow widths (full value stays in `title`).
 */
export const TIMELINE_HANDOFF_TIMESTAMP =
  'min-w-0 truncate text-[10px] font-mono font-bold tabular-nums whitespace-nowrap text-chatroom-text-muted';

/**
 * Below `sm` (640px) the bar meta wraps onto its own full-width row under the summary content. Its
 * 1.375rem (22px) left padding is the 14px icon plus the 8px gap. The bar's own 16px padding already
 * sits before the meta box, so the text lines up with the content's left edge. The 16px line keeps
 * the stacked row short. From `sm` upward these classes have no effect. Module-private: composed into
 * TIMELINE_HANDOFF_META and TIMELINE_BAR_META_PLAIN, which are the exports the tests pin.
 */
const TIMELINE_BAR_META_STACKED =
  'max-sm:basis-full max-sm:max-w-full max-sm:pl-[1.375rem] max-sm:leading-4';

/**
 * Collapsed bar meta for non-handoff rows: the single-line treatment these bars had before the
 * handoff meta column existed. Non-handoff rows never get a time row or an agent line.
 * Below `sm` it stacks under the content (see TIMELINE_BAR_META_STACKED).
 */
export const TIMELINE_BAR_META_PLAIN =
  'flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-5 ' + TIMELINE_BAR_META_STACKED;

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

/** Full-width summary bar for collapsible handoff rows. It opens the details dialog, so the row height never changes. Below `sm` the meta wraps to a second row. */
export const TIMELINE_HANDOFF_TRIGGER =
  'group/handoff-trigger flex w-full items-start gap-2 max-sm:flex-wrap max-sm:gap-y-1 px-4 py-2 text-left cursor-pointer ' +
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
 * Collapsed bar meta column. From `sm`: two right-anchored lines, top-aligned with the first preview
 * line, capped at `max-w-[55%]`. Line 1 is the time row (timestamp + duration slot). Line 2 is the agent
 * line, hidden below `sm`. Below `sm` it is a full-width row under the content, left-aligned.
 */
export const TIMELINE_HANDOFF_META =
  'flex min-w-0 max-w-[55%] shrink-0 flex-col items-end leading-5 max-sm:items-start ' +
  TIMELINE_BAR_META_STACKED;

/** Collapsed bar line 1: timestamp then the fixed duration slot. 20px tall from `sm`, 16px below. */
export const TIMELINE_HANDOFF_META_TIME_ROW =
  'flex h-5 items-center justify-end gap-2 whitespace-nowrap max-sm:h-4 max-sm:max-w-full max-sm:justify-start';

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

/** Plan bar content column: title line over the phase overview line. */
export const TIMELINE_PLAN_SUMMARY_COLUMN = 'flex min-w-0 flex-1 flex-col gap-0.5';

/** Plan title: one 20px line, bold, truncates. Centres the 14px icon (mt-[3px]) like the handoff bar. */
export const TIMELINE_PLAN_SUMMARY_TITLE =
  'block min-w-0 truncate text-sm font-bold leading-5 text-chatroom-text-primary';

/** Phase overview: at most two 16px lines. */
export const TIMELINE_PLAN_SUMMARY_PHASES =
  'block min-w-0 line-clamp-2 [overflow-wrap:anywhere] text-xs leading-4 text-chatroom-text-secondary ' +
  'group-hover/handoff-trigger:text-chatroom-text-primary';

/** "3 PHASES" count prefix. */
export const TIMELINE_PLAN_SUMMARY_COUNT =
  'mr-2 font-mono text-[10px] font-bold uppercase tracking-wide tabular-nums text-chatroom-text-muted';

/** "P1" id before each phase title. */
export const TIMELINE_PLAN_SUMMARY_PHASE_ID =
  'font-mono text-[10px] font-bold tabular-nums text-chatroom-text-muted';
