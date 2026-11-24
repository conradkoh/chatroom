/**
 * The one shared download-format model. Every host that offers a download — the chat
 * message picker and the workspace file dropdowns — reads its label, busy copy, failure
 * copy and native save-dialog options from here, so the hosts cannot drift apart.
 */

export type DownloadFormat = 'md' | 'docx' | 'pdf';

export interface DownloadFormatDefinition {
  /** Stable key used by handlers and tests. */
  format: DownloadFormat;
  /** Menu label shown in every host: the chat picker and the file dropdown. */
  label: string;
  /** Progress label shown only on the active row while it runs; null when the format has no busy state. */
  busyLabel: string | null;
  /** Inline failure copy. The host decides where to render it. */
  failureMessage: string;
  extension: '.md' | '.docx' | '.pdf';
  mimeType: string;
  /**
   * Native save-dialog description for DOCX and PDF. Omitted for Markdown: its saves go
   * through `saveTextFile`, which supplies its own save options.
   */
  saveDescription?: string;
}

/** Order is the menu order in every host: Markdown, DOCX, PDF. */
export const DOWNLOAD_FORMATS: readonly DownloadFormatDefinition[] = [
  {
    format: 'md',
    label: 'Download as Markdown',
    busyLabel: null,
    failureMessage: 'Failed to save Markdown',
    extension: '.md',
    mimeType: 'text/markdown',
    // No saveDescription: Markdown saves go through saveTextFile.
  },
  {
    format: 'docx',
    label: 'Download as DOCX',
    busyLabel: 'Preparing DOCX...',
    failureMessage: 'Failed to prepare DOCX',
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    saveDescription: 'Word Document',
  },
  {
    format: 'pdf',
    label: 'Download as PDF',
    busyLabel: 'Preparing PDF...',
    failureMessage: 'Failed to prepare PDF',
    extension: '.pdf',
    mimeType: 'application/pdf',
    saveDescription: 'PDF Document',
  },
];

export function getDownloadFormat(format: DownloadFormat): DownloadFormatDefinition {
  const definition = DOWNLOAD_FORMATS.find((candidate) => candidate.format === format);
  if (!definition) throw new Error(`Unknown download format: ${format}`);
  return definition;
}

/**
 * Suggested file name for a workspace file. Only the final path segment is used:
 * Markdown keeps it unchanged; DOCX/PDF replace the final extension with their own.
 */
export function downloadFileName(sourcePath: string, format: DownloadFormat): string {
  const slash = sourcePath.lastIndexOf('/');
  const sourceName = slash === -1 ? sourcePath : sourcePath.slice(slash + 1);
  if (format === 'md') return sourceName;
  const dot = sourceName.lastIndexOf('.');
  const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${stem}${getDownloadFormat(format).extension}`;
}
