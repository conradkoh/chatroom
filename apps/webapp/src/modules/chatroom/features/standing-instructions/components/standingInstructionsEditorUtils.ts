import type { KeyboardEvent } from 'react';

export function wantsStandingConfirm(
  e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
): boolean {
  if (e.key !== 'Enter') return false;
  return e.metaKey || e.ctrlKey;
}

export function onStandingEditorKeyDown(
  e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  onCancel: () => void,
  onConfirm: () => void
): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    onCancel();
    return;
  }
  if (!wantsStandingConfirm(e)) return;
  e.preventDefault();
  onConfirm();
}
