import { convertHtmlToDocx } from 'dom-docx/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportMessageAsDocx } from './exportMessageAsDocx';

const mockPromptSaveFile = vi.fn().mockResolvedValue({ kind: 'anchor' });
const mockWriteBlobToSaveTarget = vi.fn().mockResolvedValue('downloaded');

vi.mock('dom-docx/browser', () => ({
  convertHtmlToDocx: vi.fn().mockResolvedValue(
    new Blob(['docx-content'], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
  ),
}));

vi.mock('./replaceMermaidFencesWithSvg', () => ({
  replaceMermaidFencesWithSvg: vi.fn((md: string) =>
    Promise.resolve({ markdown: md, diagrams: new Map() })
  ),
  MERMAID_EXPORT_PLACEHOLDER_PREFIX: 'MERMAID_EXPORT_PLACEHOLDER_',
}));

vi.mock('./downloadTextFile', () => ({
  messageExportFilename: () => 'test.docx',
  promptSaveFile: (...args: unknown[]) => mockPromptSaveFile(...args),
  writeBlobToSaveTarget: (...args: unknown[]) => mockWriteBlobToSaveTarget(...args),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => `<div>${children}</div>`,
}));

describe('exportMessageAsDocx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPromptSaveFile.mockResolvedValue({ kind: 'anchor' });
    mockWriteBlobToSaveTarget.mockResolvedValue('downloaded');
  });
  it('prompts before converting and writes blob to save target', async () => {
    const message = {
      _id: 'msg-1',
      type: 'message' as const,
      senderRole: 'user',
      content: 'Hello **world**',
      _creationTime: 1_700_000_000_000,
    };

    await exportMessageAsDocx(message as never);

    expect(mockPromptSaveFile).toHaveBeenCalledWith('test.docx', {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extensions: ['.docx'],
      description: 'Word Document',
    });

    expect(convertHtmlToDocx).toHaveBeenCalledOnce();
    expect(convertHtmlToDocx).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        styleSource: 'computed',
        rasterizeInPlace: { scale: 2 },
        root: expect.any(HTMLDivElement),
      })
    );

    expect(mockWriteBlobToSaveTarget).toHaveBeenCalledWith(
      { kind: 'anchor' },
      'test.docx',
      expect.any(Blob)
    );
  });

  it('does not convert when save prompt is cancelled', async () => {
    mockPromptSaveFile.mockResolvedValueOnce({ kind: 'cancelled' });

    const message = {
      _id: 'msg-1',
      type: 'message' as const,
      senderRole: 'user',
      content: 'Hello **world**',
      _creationTime: 1_700_000_000_000,
    };

    const result = await exportMessageAsDocx(message as never);
    expect(result).toBe('cancelled');
    expect(convertHtmlToDocx).not.toHaveBeenCalled();
  });
});
