/** Shared row chrome for timeline cells. */
export const TIMELINE_ROW_BORDER = 'border-b-2 border-chatroom-border';

/** Row root — establishes an isolated stacking context for sticky header vs body. */
export const TIMELINE_ROW_ROOT = 'relative isolate';

/** Message body — stays below the sticky header within the row. */
export const TIMELINE_MESSAGE_BODY = 'relative z-0';

/** Sticky header within a timeline row — keeps sender/target visible while scrolling long bodies. */
export const TIMELINE_MESSAGE_HEADER_STICKY =
  'sticky top-0 z-10 bg-chatroom-bg-primary border-b border-chatroom-border';

/** Virtual-row z-index so later rows stack above earlier sticky headers. 1-based. */
export function getTimelineVirtualRowZIndex(index: number): number {
  return index + 1;
}

/** Scrollable timeline/message list — reserves gutter so sticky row headers do not paint over the scrollbar. */
export const TIMELINE_SCROLL_CONTAINER = 'overflow-y-auto [scrollbar-gutter:stable]';

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
