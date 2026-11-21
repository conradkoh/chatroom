import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportMessageAsPdf } from './exportMessageAsPdf';
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

/** jsdom has no layout: stub block bounds and the export root height in call order. */
function stubLayout(rects: Rect[], totalHeight: number): void {
  let index = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
    const rect = rects[index++] ?? { top: 0, bottom: 0 };
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
    stubLayout([], 1000);
    const message = makeMessage('Intro\n\n```mermaid\ngraph TD; A-->B\n```\n\nOutro');

    await exportMessageAsPdf(message);

    const exportRoot = mocks.html2canvas.mock.calls[0][0] as HTMLElement;
    expect(exportRoot.querySelector('.export-diagram svg#diagram')).not.toBeNull();
    expect(exportRoot.textContent).not.toContain('MERMAID_EXPORT_PLACEHOLDER_');
    expect(exportRoot.querySelector('code.language-mermaid')).toBeNull();
  });

  it('paginates at block boundaries', async () => {
    // Header P [0,500], HR [500,560], paragraph [560,1000], paragraph [1000,1500].
    stubLayout(
      [
        { top: 0, bottom: 1500 }, // export root, used as the origin
        { top: 0, bottom: 500 },
        { top: 500, bottom: 560 },
        { top: 560, bottom: 1000 },
        { top: 1000, bottom: 1500 },
      ],
      1500
    );

    await exportMessageAsPdf(makeMessage('First paragraph.\n\nSecond paragraph.'));

    // The last two blocks fit on no single page together: the cut lands on the 1000px block top.
    expect(mocks.drawImage.mock.calls.map((call) => call[2])).toEqual([0, 2000]);
    expect(mocks.addPage).toHaveBeenCalledTimes(1);
    expect(mocks.addImage).toHaveBeenCalledTimes(2);
  });

  it('clamps raster scale for very tall messages', async () => {
    stubLayout([], 20000);

    await exportMessageAsPdf(makeMessage('Tall'));

    expect(mocks.html2canvas).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ scale: expect.closeTo(16384 / 20000, 10) })
    );
  });

  it('clamps raster scale so the canvas area stays under the browser limit', async () => {
    stubLayout([], 8000);

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
    stubLayout([], 1000);

    await exportMessageAsPdf(makeMessage('Short'));

    expect(mocks.html2canvas).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ scale: 2 })
    );
  });

  it('encodes each page as a white-backed JPEG at quality 0.9', async () => {
    stubLayout([], 1000);

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
});
