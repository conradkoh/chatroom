// File type detection utilities

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
