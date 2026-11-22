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

const SAVE_CONFLICT_COPY = 'Another standing instruction with this content already exists.';
const SAVE_FAILED_COPY = 'Failed to update standing instruction. Please try again.';

/** Maps a failed save to the copy shown inside the edit/create dialog. */
export function standingInstructionSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return message.includes('CONFLICT') || message.includes('already exists')
    ? SAVE_CONFLICT_COPY
    : SAVE_FAILED_COPY;
}
