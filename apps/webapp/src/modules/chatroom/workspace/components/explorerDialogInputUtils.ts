import type { KeyboardEvent } from 'react';

/** Validates a single path segment (file or folder name). */
// fallow-ignore-next-line complexity
export function validateEntryName(name: string, label = 'Name'): string | null {
  const trimmed = name.trim();
  if (!trimmed) return `${label} is required`;
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'Enter a name only';
  if (trimmed.includes('..')) return 'Invalid name';
  if (trimmed.includes('\0')) return 'Invalid name';
  return null;
}

// fallow-ignore-next-line complexity
export function handleDialogSaveKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  onSave: () => void
): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    onSave();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    onSave();
  }
}
