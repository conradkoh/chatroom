import { downloadFileName } from './downloadFormats';
import type { SaveFileResult } from './downloadTextFile';
import { exportMarkdownAsDocx } from './exportMessageAsDocx';
import { exportMarkdownAsPdf } from './exportMessageAsPdf';

/**
 * File-facing export adapters: no chat header, and the suggested name comes from the
 * source path's base name (`docs/README.md` → `README.docx` / `README.pdf`).
 */
export function exportFileAsDocx(filePath: string, content: string): Promise<SaveFileResult> {
  return exportMarkdownAsDocx({
    markdown: content,
    suggestedName: downloadFileName(filePath, 'docx'),
  });
}

export function exportFileAsPdf(filePath: string, content: string): Promise<SaveFileResult> {
  return exportMarkdownAsPdf({
    markdown: content,
    suggestedName: downloadFileName(filePath, 'pdf'),
  });
}
