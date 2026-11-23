/** Stable element id for a plan anchor. `key` is `'phases'` or a phase id such as `'P2'`. */
export const planAnchorId = (messageId: string, key: string): string => `plan-${messageId}-${key}`;

/** The unambiguous reference a user copies: `<planId>#P2`. */
export const planPhaseRef = (messageId: string, phaseId: string): string =>
  `${messageId}#${phaseId}`;

/** Visible short form of a Convex id. Ids of 12 characters or fewer render in full. */
export const shortPlanId = (id: string): string =>
  id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;

/**
 * Scrolls the anchor target to the top of the scroll container (`scroll-mt-10` clears the
 * row's sticky header), then moves focus to it without scrolling again. No hash change.
 * Reduced motion → `behavior: 'auto'`. A missing target is a no-op.
 */
export function jumpToPlanAnchor(targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}
