/** Returns true when scroll position is within thresholdPx of the bottom. */
export function isScrollAtBottom(element: HTMLElement, thresholdPx = 48): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= thresholdPx;
}
