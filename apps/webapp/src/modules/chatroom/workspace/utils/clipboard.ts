import { toast } from 'sonner';

export function joinWorkingDirPath(workingDir: string, relativePath: string): string {
  const base = workingDir.replace(/[/\\]+$/, '');
  if (!relativePath) return base;
  const separator = base.includes('\\') ? '\\' : '/';
  return `${base}${separator}${relativePath.replace(/^[/\\]+/, '')}`;
}

export async function copyTextToClipboard(text: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch {
    toast.error('Failed to copy to clipboard');
  }
}
