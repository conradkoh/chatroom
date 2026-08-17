/**
 * Whether @ file-reference autocomplete is visible in the chat composer.
 * Used to bind file-tree watches without prop drilling through explorer panels.
 */

let autocompleteVisible = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

// fallow-ignore-next-line unused-export
export function __resetFileTreeAutocompleteVisibleForTests(): void {
  autocompleteVisible = false;
  notify();
}

export function setFileTreeAutocompleteVisible(visible: boolean): void {
  if (autocompleteVisible === visible) return;
  autocompleteVisible = visible;
  notify();
}

export function getFileTreeAutocompleteVisible(): boolean {
  return autocompleteVisible;
}

export function subscribeFileTreeAutocompleteVisible(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
