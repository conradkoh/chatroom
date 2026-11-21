import { getFileName } from '@/lib/pathUtils';

const COPY_FAILED_MESSAGE = 'Failed to copy to clipboard';

/** Outcome of a copy helper. A success carries no display text; hosts decide what to show. */
export type CopyResult = { ok: true } | { ok: false; message: typeof COPY_FAILED_MESSAGE };

function joinWorkingDirPath(workingDir: string, relativePath: string): string {
  const base = workingDir.replace(/[/\\]+$/, '');
  if (!relativePath) return base;
  const separator = base.includes('\\') ? '\\' : '/';
  return `${base}${separator}${relativePath.replace(/^[/\\]+/, '')}`;
}

export async function copyTextToClipboard(text: string): Promise<CopyResult> {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, message: COPY_FAILED_MESSAGE };
  }
}

export async function copyFileNameToClipboard(path: string): Promise<CopyResult> {
  return copyTextToClipboard(getFileName(path));
}

export async function copyRelativePathToClipboard(path: string): Promise<CopyResult> {
  return copyTextToClipboard(path);
}

// Unreachable from menus: the Copy Full Path item is disabled without a workingDir. Nothing is written.
export async function copyFullPathToClipboard(
  workingDir: string | null,
  relativePath: string
): Promise<CopyResult> {
  if (!workingDir) return { ok: false, message: COPY_FAILED_MESSAGE };
  return copyTextToClipboard(joinWorkingDirPath(workingDir, relativePath));
}

export async function copyWorkspacePathToClipboard(workingDir: string): Promise<CopyResult> {
  return copyTextToClipboard(workingDir);
}

export async function copyFileContentToClipboard(content: string): Promise<CopyResult> {
  return copyTextToClipboard(content);
}
