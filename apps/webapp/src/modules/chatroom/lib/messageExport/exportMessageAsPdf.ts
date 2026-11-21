import type { jsPDF } from 'jspdf';

import {
  buildMessageExportDom,
  MESSAGE_EXPORT_WIDTH_PX,
  offscreenExportRootStyle,
} from './buildMessageExportDom';
import {
  computePdfPageSlices,
  type PdfBlockBounds,
  type PdfPageSlice,
} from './computePdfPageSlices';
import {
  messageExportFilename,
  promptSaveFile,
  writeBlobToSaveTarget,
  type SaveFileResult,
} from './downloadTextFile';
import type { Message } from '../../types/message';

const PDF_MIME_TYPE = 'application/pdf';
const PAGE_MARGIN_PT = 40;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const CONTENT_WIDTH_PT = A4_WIDTH_PT - 2 * PAGE_MARGIN_PT;
const CONTENT_HEIGHT_PT = A4_HEIGHT_PT - 2 * PAGE_MARGIN_PT;
const PT_PER_CSS_PX = CONTENT_WIDTH_PT / MESSAGE_EXPORT_WIDTH_PX;
const PAGE_HEIGHT_CSS_PX = CONTENT_HEIGHT_PT / PT_PER_CSS_PX;
/** Browsers refuse canvases taller than ~16384 px in one dimension. */
const MAX_CANVAS_PX = 16384;
/** Browsers also cap total canvas pixels (iOS Safari ~16.7 Mpx). Width is MESSAGE_EXPORT_WIDTH_PX * scale. */
const MAX_CANVAS_AREA_PX = 16_777_216;
const MAX_RASTER_SCALE = 2;
/** JPEG quality for page images. Keeps 13px body text and Mermaid edges crisp at 100% zoom. */
const PAGE_IMAGE_QUALITY = 0.9;

/**
 * Exports a message as an image-based (non-selectable text) A4 PDF.
 *
 * Constraints:
 * - The save prompt runs first so the native file picker keeps the user gesture.
 * - `jspdf` and `html2canvas-pro` are loaded with dynamic imports to keep them out of the main bundle.
 * - The export root is off-screen but visible: html2canvas skips `visibility:hidden` elements.
 * - Page cuts happen on block boundaries via `computePdfPageSlices`, never mid-block unless a
 *   single block is taller than a page.
 * - Raster scale is clamped so the canvas never exceeds the browser height or area limits.
 * - Pages are JPEG (quality 0.9) to keep the file shareable; text stays legible at 100% zoom.
 */
export async function exportMessageAsPdf(message: Message): Promise<SaveFileResult> {
  const suggestedName = messageExportFilename(message, 'pdf');
  const saveTarget = await promptSaveFile(suggestedName, {
    mimeType: PDF_MIME_TYPE,
    extensions: ['.pdf'],
    description: 'PDF Document',
  });
  if (saveTarget.kind === 'cancelled') return 'cancelled';

  const { root, pageBlocks } = await buildMessageExportDom(
    message,
    // Off-screen but VISIBLE: html2canvas skips visibility:hidden. Do not add visibility:hidden.
    offscreenExportRootStyle('')
  );
  document.body.appendChild(root);
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas-pro'),
      import('jspdf'),
    ]);
    const heightPx = root.scrollHeight;
    const scale = Math.min(
      MAX_RASTER_SCALE,
      MAX_CANVAS_PX / heightPx,
      Math.sqrt(MAX_CANVAS_AREA_PX / (MESSAGE_EXPORT_WIDTH_PX * heightPx))
    );
    const canvas = await html2canvas(root, {
      scale,
      backgroundColor: '#ffffff', // PDF paper, not a theme colour
      useCORS: true,
      logging: false,
      width: MESSAGE_EXPORT_WIDTH_PX,
      height: heightPx,
      windowWidth: MESSAGE_EXPORT_WIDTH_PX,
    });
    const slices = computePdfPageSlices(
      measureBlocks(root, pageBlocks),
      PAGE_HEIGHT_CSS_PX,
      heightPx
    );
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    addSlicesToPdf(pdf, canvas, slices, scale);
    return writeBlobToSaveTarget(saveTarget, suggestedName, pdf.output('blob'));
  } finally {
    document.body.removeChild(root);
  }
}

/** Block bounds relative to the export root, in CSS px. */
function measureBlocks(root: HTMLElement, blocks: HTMLElement[]): PdfBlockBounds[] {
  const originTop = root.getBoundingClientRect().top;
  return blocks.map((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top - originTop, bottom: rect.bottom - originTop };
  });
}

/** One PDF page per slice; the slice is cropped out of the single full-height canvas. */
function addSlicesToPdf(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  slices: PdfPageSlice[],
  scale: number
): void {
  slices.forEach((slice, i) => {
    if (i > 0) pdf.addPage();
    const pageCanvas = cropCanvas(
      canvas,
      Math.round(slice.start * scale),
      Math.round(slice.end * scale)
    );
    pdf.addImage(
      pageCanvas.toDataURL('image/jpeg', PAGE_IMAGE_QUALITY),
      'JPEG',
      PAGE_MARGIN_PT,
      PAGE_MARGIN_PT,
      CONTENT_WIDTH_PT,
      (slice.end - slice.start) * PT_PER_CSS_PX
    );
  });
}

function cropCanvas(source: HTMLCanvasElement, startPx: number, endPx: number): HTMLCanvasElement {
  const height = endPx - startPx;
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  // JPEG has no alpha channel: paint the paper white first so no pixel can encode as black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, startPx, source.width, height, 0, 0, source.width, height);
  return out;
}
