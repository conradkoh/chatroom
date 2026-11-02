/**
 * Composer → scheduled-prompts handoff store.
 *
 * The composer and the scheduled-prompts dialog live in different subtrees, so a
 * module-level store carries the "schedule this draft instead of sending it"
 * request: the composer writes a prefill (and the callback that clears its
 * draft), the dialog reads it to open, and the dialog clears it when the form
 * closes. No window events or React context are involved.
 */

type Listener = () => void;

/** Text and attachment flag captured from the composer draft. */
export interface ScheduledPromptPrefill {
  prompt: string;
  hasAttachments: boolean;
}

export interface PendingScheduledPrompt {
  prefill: ScheduledPromptPrefill;
  /** Fired after the scheduled prompt is created, so the composer can clear its draft. */
  onScheduled?: () => void;
}

const listeners = new Set<Listener>();
let pending: PendingScheduledPrompt | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Ask the scheduled-prompts dialog to open prefilled with the composer draft.
 * Replaces any previous pending request.
 */
export function requestScheduledPrompt(
  prefill: ScheduledPromptPrefill,
  onScheduled?: () => void
): void {
  pending = { prefill, onScheduled };
  notify();
}

/** Drop the pending request. Called when the prefilled form closes. */
export function clearPendingScheduledPrompt(): void {
  if (pending === null) return;
  pending = null;
  notify();
}

/** Stable snapshot for `useSyncExternalStore`. */
export function getPendingScheduledPrompt(): PendingScheduledPrompt | null {
  return pending;
}

/** Server snapshot: there is never a pending composer request during SSR. */
export function getPendingScheduledPromptServerSnapshot(): PendingScheduledPrompt | null {
  return null;
}

export function subscribePendingScheduledPrompt(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
