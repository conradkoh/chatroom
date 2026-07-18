import { convertHtmlToDocx } from 'dom-docx/browser';
import { describe, expect, it, vi } from 'vitest';

import { downloadBlobFile } from './downloadTextFile';
import { exportMessageAsDocx } from './exportMessageAsDocx';

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
  downloadBlobFile: vi.fn(),
  messageExportFilename: () => 'test.docx',
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => `<div>${children}</div>`,
}));

describe('exportMessageAsDocx', () => {
  it('calls convertHtmlToDocx with computed style source and no dark theme tokens', async () => {
    const message = {
      _id: 'msg-1',
      type: 'message' as const,
      senderRole: 'user',
      content: 'Hello **world**',
      _creationTime: 1_700_000_000_000,
    };

    await exportMessageAsDocx(message as never);

    expect(convertHtmlToDocx).toHaveBeenCalledOnce();
    expect(convertHtmlToDocx).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        styleSource: 'computed',
        rasterizeInPlace: { scale: 2 },
        root: expect.any(HTMLDivElement),
      })
    );

    const htmlArg = vi.mocked(convertHtmlToDocx).mock.calls[0]![0] as string;
    expect(htmlArg).not.toContain('bg-chatroom-bg-primary');
    expect(htmlArg).not.toContain('dark:prose-invert');

    expect(downloadBlobFile).toHaveBeenCalledOnce();
    expect(downloadBlobFile).toHaveBeenCalledWith('test.docx', expect.any(Blob));
  });
});
