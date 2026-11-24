import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportMarkdownAsPdf, exportMessageAsPdf } from './exportMessageAsPdf';
import type { Message } from '../../types/message';

const mocks = vi.hoisted(() => ({
  promptSaveFile: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  writeBlobToSaveTarget: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  messageExportFilename: vi.fn<(...args: unknown[]) => string>(),
  html2canvas: vi.fn<(...args: unknown[]) => Promise<HTMLCanvasElement>>(),
  addPage: vi.fn(),
  addImage: vi.fn(),
  output: vi.fn(),
  drawImage: vi.fn(),
  fillRect: vi.fn(),
}));

vi.mock('html2canvas-pro', () => ({
  default: (...args: unknown[]) => mocks.html2canvas(...args),
}));

vi.mock('jspdf', () => {
  class MockJsPDF {
    addPage = mocks.addPage;
    addImage = mocks.addImage;
    output = mocks.output;
  }
  return { jsPDF: MockJsPDF };
});

vi.mock('./downloadTextFile', () => ({
  messageExportFilename: (...args: unknown[]) => mocks.messageExportFilename(...args),
  promptSaveFile: (...args: unknown[]) => mocks.promptSaveFile(...args),
  writeBlobToSaveTarget: (...args: unknown[]) => mocks.writeBlobToSaveTarget(...args),
}));

vi.mock('./replaceMermaidFencesWithSvg', () => ({
  MERMAID_EXPORT_PLACEHOLDER_PREFIX: 'MERMAID_EXPORT_PLACEHOLDER_',
  replaceMermaidFencesWithSvg: (markdown: string) =>
    Promise.resolve({
      markdown: markdown.replace(
        /```mermaid\n[\s\S]*?```/g,
        '\n\nMERMAID_EXPORT_PLACEHOLDER_0\n\n'
      ),
      diagrams: new Map([[0, '<svg id="diagram"></svg>']]),
    }),
}));

type Rect = { top: number; bottom: number };

/**
 * jsdom has no layout. Each element's box comes from `rectOf`, keyed by the element itself,
 * so an extra layout read cannot shift results.
 */
function stubLayout(rectOf: (el: Element) => Rect, totalHeight: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rect = rectOf(this);
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: 0,
      right: 816,
      width: 816,
      height: rect.bottom - rect.top,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    } as DOMRect;
  });
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(totalHeight);
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1632;
  canvas.height = 3000;
  return canvas;
}

function makeMessage(content: string): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content,
    _creationTime: 1_700_000_000_000,
  } as Message;
}

describe('exportMessageAsPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageExportFilename.mockImplementation((_message, ext) => `test.${String(ext)}`);
    mocks.promptSaveFile.mockResolvedValue({ kind: 'anchor' });
    mocks.writeBlobToSaveTarget.mockResolvedValue('downloaded');
    mocks.output.mockReturnValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    mocks.html2canvas.mockImplementation(async () => makeCanvas());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: mocks.drawImage,
      fillRect: mocks.fillRect,
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,AA=='
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prompts the save dialog with a .pdf name before generating', async () => {
    const message = makeMessage('Hello **world**');

    const result = await exportMessageAsPdf(message);

    expect(mocks.promptSaveFile).toHaveBeenCalledWith('test.pdf', {
      mimeType: 'application/pdf',
      extensions: ['.pdf'],
      description: 'PDF Document',
    });
    expect(mocks.promptSaveFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.html2canvas.mock.invocationCallOrder[0]
    );
    expect(mocks.writeBlobToSaveTarget).toHaveBeenCalledWith(
      { kind: 'anchor' },
      'test.pdf',
      expect.any(Blob)
    );
    expect(result).toBe('downloaded');
  });

  it('does not render when the save prompt is cancelled', async () => {
    mocks.promptSaveFile.mockResolvedValueOnce({ kind: 'cancelled' });

    const result = await exportMessageAsPdf(makeMessage('Hello'));

    expect(result).toBe('cancelled');
    expect(mocks.html2canvas).not.toHaveBeenCalled();
    expect(document.querySelector('.chatroom-root')).toBeNull();
  });

  it('renders Mermaid fences as diagrams in the PDF source', async () => {
    stubLayout(() => ({ top: 0, bottom: 0 }), 1000);
    const message = makeMessage('Intro\n\n```mermaid\ngraph TD; A-->B\n```\n\nOutro');

    await exportMessageAsPdf(message);

    const exportRoot = mocks.html2canvas.mock.calls[0][0] as HTMLElement;
    expect(exportRoot.querySelector('.export-diagram svg#diagram')).not.toBeNull();
    expect(exportRoot.textContent).not.toContain('MERMAID_EXPORT_PLACEHOLDER_');
    expect(exportRoot.querySelector('code.language-mermaid')).toBeNull();
  });

  it('paginates at block boundaries', async () => {
    // Blocks: header P [0,500], HR [500,560], paragraph [560,1000], paragraph [1000,1500]. Root is 1500 tall.
    // PAGE_HEIGHT_CSS_PX (exportMessageAsPdf.ts) ≈ 1206.5: A4 content height 761.89pt ÷ 0.63147 pt/px.
    // The 1500px total exceeds one page, so the last block (1000–1500) starts a new page at its top, 1000.
    stubLayout((el) => {
      if (el.classList.contains('chatroom-root')) return { top: 0, bottom: 1500 };
      if (el.tagName === 'HR') return { top: 500, bottom: 560 };
      if (el.tagName === 'P' && el.textContent?.startsWith('user')) return { top: 0, bottom: 500 };
      if (el.textContent === 'First paragraph.') return { top: 560, bottom: 1000 };
      if (el.textContent === 'Second paragraph.') return { top: 1000, bottom: 1500 };
      return { top: 0, bottom: 0 };
    }, 1500);

    await exportMessageAsPdf(makeMessage('First paragraph.\n\nSecond paragraph.'));

    // drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight): sy = call[2], sHeight = call[4]
    expect(mocks.drawImage.mock.calls.map((c) => c[2])).toEqual([0, 2000]);
    expect(mocks.drawImage.mock.calls.map((c) => c[4])).toEqual([2000, 1000]);
    // addImage(data, format, x, y, w, h): slice heights in pt = css px × 0.63147
    expect(mocks.addImage.mock.calls.map((c) => c[5])).toEqual([
      expect.closeTo(631.47, 1),
      expect.closeTo(315.74, 1),
    ]);
    expect(mocks.addPage).toHaveBeenCalledTimes(1);
    expect(mocks.addImage).toHaveBeenCalledTimes(2);
  });

  it('renders a connected, visible export root at the export width and removes it afterwards', async () => {
    stubLayout(() => ({ top: 0, bottom: 0 }), 1000);
    let seen: { connected: boolean; visibility: string } | undefined;
    mocks.html2canvas.mockImplementationOnce(async (el: unknown) => {
      const root = el as HTMLElement;
      seen = { connected: root.isConnected, visibility: root.style.visibility };
      return makeCanvas();
    });

    await exportMessageAsPdf(makeMessage('Short'));

    expect(seen).toEqual({ connected: true, visibility: '' });
    expect(mocks.html2canvas).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ width: 816, windowWidth: 816, height: 1000 })
    );
    expect(mocks.addImage).toHaveBeenCalledWith(
      'data:image/jpeg;base64,AA==',
      'JPEG',
      40,
      40,
      expect.closeTo(515.28, 2),
      expect.closeTo(631.47, 1)
    );
    expect(document.querySelector('.chatroom-root')).toBeNull();
  });

  it('clamps raster scale for very tall messages', async () => {
    stubLayout(() => ({ top: 0, bottom: 0 }), 20000);

    await exportMessageAsPdf(makeMessage('Tall'));

    expect(mocks.html2canvas).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ scale: expect.closeTo(16384 / 20000, 10) })
    );
  });

  it('clamps raster scale so the canvas area stays under the browser limit', async () => {
    stubLayout(() => ({ top: 0, bottom: 0 }), 8000);

    await exportMessageAsPdf(makeMessage('Tall'));

    const { scale } = mocks.html2canvas.mock.calls[0][1] as { scale: number };
    expect(scale).toBeCloseTo(1.6031, 3);
    // The browser allocates an integer-sized canvas: width*scale and height*scale rounded.
    // The exact float product is 16777216.000000004 (one ulp over), which no canvas can express.
    const canvasWidth = Math.round(816 * scale);
    const canvasHeight = Math.round(8000 * scale);
    expect(canvasWidth * canvasHeight).toBeLessThanOrEqual(16_777_216);
  });

  it('rasterises short messages at the maximum scale', async () => {
    stubLayout(() => ({ top: 0, bottom: 0 }), 1000);

    await exportMessageAsPdf(makeMessage('Short'));

    expect(mocks.html2canvas).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ scale: 2 })
    );
  });

  it('encodes each page as a white-backed JPEG at quality 0.9', async () => {
    stubLayout(() => ({ top: 0, bottom: 0 }), 1000);

    await exportMessageAsPdf(makeMessage('Short'));

    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
    expect(mocks.addImage).toHaveBeenCalledWith(
      'data:image/jpeg;base64,AA==',
      'JPEG',
      40,
      40,
      expect.any(Number),
      expect.any(Number)
    );
    expect(mocks.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.drawImage.mock.invocationCallOrder[0]
    );
  });

  it('removes the export root and rethrows when rendering fails', async () => {
    mocks.html2canvas.mockRejectedValueOnce(new Error('boom'));

    await expect(exportMessageAsPdf(makeMessage('Hello'))).rejects.toThrow('boom');

    expect(document.querySelector('.chatroom-root')).toBeNull();
    expect(mocks.writeBlobToSaveTarget).not.toHaveBeenCalled();
  });

  it('renders an empty markdown file as exactly one A4 page', async () => {
    stubLayout(() => ({ top: 0, bottom: 0 }), 0);

    const result = await exportMarkdownAsPdf({ markdown: '', suggestedName: 'README.pdf' });

    expect(result).toBe('downloaded');
    expect(mocks.promptSaveFile).toHaveBeenCalledWith('README.pdf', {
      mimeType: 'application/pdf',
      extensions: ['.pdf'],
      description: 'PDF Document',
    });
    expect(mocks.html2canvas).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ height: 1 })
    );
    expect(mocks.addImage).toHaveBeenCalledTimes(1);
    expect(mocks.addPage).not.toHaveBeenCalled();
  });
});
