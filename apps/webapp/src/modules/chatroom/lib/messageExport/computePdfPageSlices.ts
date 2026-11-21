export type PdfBlockBounds = { top: number; bottom: number };
export type PdfPageSlice = { start: number; end: number };

/**
 * Splits [0, totalHeight] into page-sized slices whose cut points fall on block boundaries.
 * `blocks` must be sorted by top and non-overlapping (CSS px, relative to the export root).
 * A block taller than a page is cut every `pageHeight` px (unavoidable).
 */
export function computePdfPageSlices(
  blocks: readonly PdfBlockBounds[],
  pageHeight: number,
  totalHeight: number
): PdfPageSlice[] {
  if (!(pageHeight > 0)) throw new Error('pageHeight must be positive');
  const slices: PdfPageSlice[] = [];
  let pageStart = 0;
  for (const block of blocks) {
    pageStart = appendBlockSlices(slices, block, pageStart, pageHeight);
  }
  appendTrailingSlices(slices, pageStart, totalHeight, pageHeight);
  return slices;
}

/** Appends the page(s) one block needs and returns where the next page starts. */
function appendBlockSlices(
  slices: PdfPageSlice[],
  block: PdfBlockBounds,
  pageStart: number,
  pageHeight: number
): number {
  if (block.bottom - pageStart <= pageHeight) return pageStart; // fits on the current page
  let start = pageStart;
  if (block.top > start) {
    // break before the block
    slices.push({ start, end: block.top });
    start = block.top;
  }
  // block still does not fit: hard-cut it at page height
  while (block.bottom - start > pageHeight) {
    slices.push({ start, end: start + pageHeight });
    start += pageHeight;
  }
  return start;
}

/** Appends the leftover region after the last block, hard-cutting it if it is longer than a page. */
function appendTrailingSlices(
  slices: PdfPageSlice[],
  pageStart: number,
  totalHeight: number,
  pageHeight: number
): void {
  let start = pageStart;
  while (totalHeight - start > pageHeight) {
    slices.push({ start, end: start + pageHeight });
    start += pageHeight;
  }
  if (totalHeight > start) slices.push({ start, end: totalHeight });
}
