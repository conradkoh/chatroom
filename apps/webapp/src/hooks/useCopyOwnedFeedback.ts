import { useCallback, useRef } from 'react';

import { useFeedback, type UseFeedbackResult } from './useFeedback';

import type { Feedback } from '@/components/inline-feedback';

/** The warning a truncated file-content copy shows. Shared by every host that reports copies. */
const TRUNCATED_FILE_COPY_MESSAGE = 'Copied file content (truncated)';

/** What a successful copy reports. `truncated` is true only when copied file content was cut short. */
export interface CopySucceededInfo {
  truncated: boolean;
}

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
  /**
   * Call on copy success. A truncated copy shows the truncation warning and becomes copy-owned.
   * Any other success clears the slot only when a copy owns it. Calling with no argument counts as not truncated.
   */
  copySucceeded: (info?: CopySucceededInfo) => void;
  /** Clears the slot and resets ownership. */
  clear: () => void;
}

/**
 * One feedback slot where copy outcomes are copy-owned: a later copy success clears a copy
 * failure or a truncation warning, but never a message written by any other surface.
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
  const copySucceeded = useCallback(
    (info?: CopySucceededInfo) => {
      if (info?.truncated) {
        copyOwnsSlotRef.current = true;
        show('warning', TRUNCATED_FILE_COPY_MESSAGE);
        return;
      }
      if (!copyOwnsSlotRef.current) return;
      clearOwned();
    },
    [clearOwned, show]
  );

  return { feedback, showError, showCopyError, report, copySucceeded, clear: clearOwned };
}
