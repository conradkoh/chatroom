/** Autosize constants and viewport-aware max height for MessageInput. */

/** Maximum visible lines before scrollbar appears (text-sm = 14px, line-height 1.5 ≈ 21px/line) */
const MAX_TEXTAREA_LINES = 20;
/** Padding: py-1.5 = 12px total (6px top + 6px bottom) */
const TEXTAREA_PADDING_PX = 12;
/** Line height in px: 14px * 1.5 = 21px */
const LINE_HEIGHT_PX = 21;
/** Max height = 20 lines * 21px + 12px padding = 432px */
export const MAX_TEXTAREA_HEIGHT_PX = MAX_TEXTAREA_LINES * LINE_HEIGHT_PX + TEXTAREA_PADDING_PX;

/** On small viewports, cap composer height to this fraction of visible viewport (50dvh equivalent). */
const VIEWPORT_MAX_HEIGHT_FRACTION = 0.5;

export function getViewportHeightPx(
  viewportHeight?: number,
  innerHeight = typeof window !== 'undefined' ? window.innerHeight : 0
): number {
  return viewportHeight ?? innerHeight;
}

/** Effective cap: min(line cap, 50% of viewport). Desktop keeps full 20-line cap. */
export function getEffectiveMaxTextareaHeightPx(
  viewportHeightPx: number,
  lineCapPx: number = MAX_TEXTAREA_HEIGHT_PX
): number {
  if (viewportHeightPx <= 0) return lineCapPx;
  return Math.min(lineCapPx, Math.floor(viewportHeightPx * VIEWPORT_MAX_HEIGHT_FRACTION));
}

/** Measure textarea content height for autosize (collapse before measuring scrollHeight). */
export function measureTextareaContentHeightPx(
  textarea: HTMLTextAreaElement,
  maxHeightPx: number
): number {
  textarea.style.height = '0px';
  return Math.min(textarea.scrollHeight, maxHeightPx);
}
