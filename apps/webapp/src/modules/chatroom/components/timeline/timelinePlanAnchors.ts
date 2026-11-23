/** Stable element id for a plan anchor. `key` is `'phases'` or a phase id such as `'P2'`. */
export const planAnchorId = (messageId: string, key: string): string => `plan-${messageId}-${key}`;

/** The unambiguous reference a user copies: `<planId>#P2`. */
export const planPhaseRef = (messageId: string, phaseId: string): string =>
  `${messageId}#${phaseId}`;

/** Visible short form of a Convex id. Ids of 12 characters or fewer render in full. */
export const shortPlanId = (id: string): string =>
  id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;

/** Row root and sticky header markers. Set by `TimelineTeamMessage`; see the shared contracts below. */
const ROW_SELECTOR = '[data-timeline-row]';
const ROW_HEADER_SELECTOR = '[data-timeline-row-header]';

/**
 * Height of the sticky header of the row that contains `target`. The header wraps onto a second
 * line at narrow widths, so it is measured at jump time, never assumed. 0 outside a timeline row.
 */
function stickyRowHeaderHeight(target: HTMLElement): number {
  const header = target.closest(ROW_SELECTOR)?.querySelector<HTMLElement>(ROW_HEADER_SELECTOR);
  return header ? header.getBoundingClientRect().height : 0;
}

/**
 * Scrolls the anchor target so its top sits just below the row's sticky header
 * (`scroll-margin-top` = the measured header height), then moves focus to it without
 * scrolling again. No hash change. Reduced motion → `behavior: 'auto'`. A missing target is a no-op.
 */
export function jumpToPlanAnchor(targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.style.scrollMarginTop = `${stickyRowHeaderHeight(target)}px`;
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}
