import { toast } from 'sonner';

import { getFileName } from '@/lib/pathUtils';

function joinWorkingDirPath(workingDir: string, relativePath: string): string {
  const base = workingDir.replace(/[/\\]+$/, '');
  if (!relativePath) return base;
  const separator = base.includes('\\') ? '\\' : '/';
  return `${base}${separator}${relativePath.replace(/^[/\\]+/, '')}`;
}

async function copyTextToClipboard(text: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch {
    toast.error('Failed to copy to clipboard');
  }
}

export async function copyFileNameToClipboard(path: string): Promise<void> {
  await copyTextToClipboard(getFileName(path), 'Copied file name');
}

export async function copyRelativePathToClipboard(path: string): Promise<void> {
  await copyTextToClipboard(path, 'Copied relative path');
}

export async function copyFullPathToClipboard(
  workingDir: string | null,
  relativePath: string
): Promise<void> {
  if (!workingDir) return;
  await copyTextToClipboard(joinWorkingDirPath(workingDir, relativePath), 'Copied full path');
}

export async function copyFileContentToClipboard(
  content: string,
  options?: { truncated?: boolean }
): Promise<void> {
  const message = options?.truncated ? 'Copied file content (truncated)' : 'Copied file content';
  await copyTextToClipboard(content, message);
}
