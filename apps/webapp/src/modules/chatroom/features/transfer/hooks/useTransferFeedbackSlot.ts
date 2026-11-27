'use client';

import { useCallback, useRef, useState } from 'react';

import type { Feedback } from '@/components/inline-feedback';
import { useFeedback } from '@/hooks/useFeedback';

export interface TransferFeedbackSlot {
  feedback: Feedback | null;
  retryable: boolean;
  show: ReturnType<typeof useFeedback>['show'];
  setRetryable(value: boolean): void;
  /** Marks a run in flight and resets the slot; false when a run already is. */
  begin(): boolean;
  finish(): void;
  dismiss(): void;
}

/** One feedback slot plus the single-run guard shared by both export adapters. */
export function useTransferFeedbackSlot(): TransferFeedbackSlot {
  const { feedback, show, clear } = useFeedback();
  const [retryable, setRetryable] = useState(false);
  const inFlight = useRef(false);

  const begin = useCallback(() => {
    if (inFlight.current) return false;
    inFlight.current = true;
    clear();
    setRetryable(false);
    return true;
  }, [clear]);

  const finish = useCallback(() => {
    inFlight.current = false;
  }, []);

  const dismiss = useCallback(() => {
    clear();
    setRetryable(false);
  }, [clear]);

  return { feedback, retryable, show, setRetryable, begin, finish, dismiss };
}
