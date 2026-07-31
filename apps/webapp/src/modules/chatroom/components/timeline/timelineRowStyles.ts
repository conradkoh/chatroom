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

/** Extra scroll classes only needed by the virtualized main feed. */
export const TIMELINE_FEED_SCROLL_EXTRAS = 'overflow-x-auto [overflow-anchor:none]';

export const BADGE_BASE =
  'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5';

export const ICON_SIZE = 10;

export function getSenderClasses(role: string): string {
  const base = 'font-bold text-[10px] uppercase tracking-wide';
  if (role.toLowerCase() === 'user') {
    return `${base} text-amber-500 dark:text-amber-400 drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]`;
  }
  if (role === 'system') return `${base} text-chatroom-status-warning`;
  return `${base} text-chatroom-status-info`;
}

export type MachineNameEntry = { hostname: string; alias?: string };

export function formatMachineLabel(
  machines: Map<string, MachineNameEntry> | undefined,
  machineId: string | undefined
): string | null {
  if (!machines || !machineId) return null;
  const entry = machines.get(machineId);
  if (!entry) return null;
  return entry.alias ?? entry.hostname;
}
