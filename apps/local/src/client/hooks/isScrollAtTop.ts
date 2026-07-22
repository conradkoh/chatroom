/** Returns true when scroll position is within thresholdPx of the top. */
export function isScrollAtTop(element: HTMLElement, thresholdPx = 48): boolean {
  return element.scrollTop <= thresholdPx;
}
