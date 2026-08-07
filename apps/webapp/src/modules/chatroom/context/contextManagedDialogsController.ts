/** Module-level store for switcher/file-selector open state — avoids ChatroomDashboard context rerender. */

import type { ContextManagedDialog } from './CommandDialogContext';

type Listener = () => void;

let activeDialog: ContextManagedDialog | null = null;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function getActiveContextManagedDialog(): ContextManagedDialog | null {
  return activeDialog;
}

export function subscribeActiveContextManagedDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFileSelectorOpen(): boolean {
  return activeDialog === 'file-selector';
}

export function getChatroomSwitcherOpen(): boolean {
  return activeDialog === 'switcher';
}

/** Set active dialog (null closes). No-op if unchanged. */
// fallow-ignore-next-line unused-export
export function setActiveContextManagedDialog(dialog: ContextManagedDialog | null): void {
  if (activeDialog === dialog) return;
  activeDialog = dialog;
  notify();
}

export function openContextManagedDialog(dialog: ContextManagedDialog): void {
  setActiveContextManagedDialog(dialog);
}

export function closeContextManagedDialog(): void {
  setActiveContextManagedDialog(null);
}

/** Reset on route change. */
export function resetContextManagedDialogs(): void {
  if (activeDialog === null) return;
  activeDialog = null;
  notify();
}

/** Test helper */
// fallow-ignore-next-line unused-export
export function resetContextManagedDialogsForTests(): void {
  activeDialog = null;
  listeners.clear();
}
