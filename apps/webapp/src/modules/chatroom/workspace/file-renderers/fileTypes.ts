// File type detection utilities

import { detectLanguage } from './language-detection';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

export function isMarkdownFile(path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return false;
  return MARKDOWN_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

export function isCsvFile(path: string): boolean {
  return /\.csv$/i.test(path);
}

// Default view mode per file type
export type FileViewMode = 'source' | 'preview' | 'table';

export function getDefaultViewMode(path: string): FileViewMode {
  if (isMarkdownFile(path)) return 'preview';
  if (isCsvFile(path)) return 'table';
  return 'source';
}

/** Whether the explorer should open a file in the editable text pane vs read-only highlighted viewer. */
export function shouldOpenInEditableExplorerPane(filePath: string): boolean {
  if (isMarkdownFile(filePath)) return true;
  if (detectLanguage(filePath)) return false;
  return true;
}
