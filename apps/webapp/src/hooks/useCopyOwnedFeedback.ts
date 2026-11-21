import { useCallback, useRef } from 'react';

import { useFeedback, type UseFeedbackResult } from './useFeedback';

import type { Feedback } from '@/components/inline-feedback';

/** A titled draft from a non-copy surface. `null` clears the slot. Structurally equal to `FeedbackDraft`. */
export type ReportedDraft = Pick<Feedback, 'tone' | 'message' | 'title' | 'items'> | null;

export interface UseCopyOwnedFeedbackResult {
  feedback: UseFeedbackResult['feedback'];
  /** A non-copy error. Replaces the slot and marks it not copy-owned. */
  showError: (message: string) => void;
  /** A copy failure. Replaces the slot and marks it copy-owned. */
  showCopyError: (message: string) => void;
  /** A non-copy draft (tone, message, title, items), or `null` to clear. Never copy-owned. */
  report: (draft: ReportedDraft) => void;
  /** Call on copy success. Clears the slot only when a copy failure owns it. */
  copySucceeded: () => void;
  /** Clears the slot and resets ownership. */
  clear: () => void;
}

/**
 * One feedback slot where copy failures are copy-owned: a later copy success clears
 * a copy failure, but never a message written by any other surface.
 */
export function useCopyOwnedFeedback(): UseCopyOwnedFeedbackResult {
  const { feedback, show, error, clear } = useFeedback();
  const copyOwnsSlotRef = useRef(false);

  const showError = useCallback(
    (message: string) => {
      copyOwnsSlotRef.current = false;
      error(message);
    },
    [error]
  );
  const showCopyError = useCallback(
    (message: string) => {
      copyOwnsSlotRef.current = true;
      error(message);
    },
    [error]
  );
  const clearOwned = useCallback(() => {
    copyOwnsSlotRef.current = false;
    clear();
  }, [clear]);
  const report = useCallback(
    (draft: ReportedDraft) => {
      if (!draft) {
        clearOwned();
        return;
      }
      copyOwnsSlotRef.current = false;
      show(draft.tone, draft.message, { title: draft.title, items: draft.items });
    },
    [clearOwned, show]
  );
  const copySucceeded = useCallback(() => {
    if (!copyOwnsSlotRef.current) return;
    clearOwned();
  }, [clearOwned]);

  return { feedback, showError, showCopyError, report, copySucceeded, clear: clearOwned };
}
