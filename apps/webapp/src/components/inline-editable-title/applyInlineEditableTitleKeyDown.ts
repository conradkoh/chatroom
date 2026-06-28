import type { KeyboardEvent } from 'react';

// fallow-ignore-next-line complexity
export function applyInlineEditableTitleKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  onSave: () => void,
  onCancel: () => void,
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
): void {
  onKeyDown?.(event);
  if (event.defaultPrevented) return;
  if (event.key === 'Enter') onSave();
  else if (event.key === 'Escape') onCancel();
}
