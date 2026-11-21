// fallow-ignore-file unused-file
import { useCallback, useRef, useState } from 'react';

import type { Feedback, FeedbackTone } from '@/components/inline-feedback';

export interface FeedbackExtra {
  title?: string;
  items?: string[];
  icon?: boolean;
}

export interface UseFeedbackResult {
  feedback: Feedback | null;
  show: (tone: FeedbackTone, message?: string, extra?: FeedbackExtra) => void;
  error: (message: string, extra?: FeedbackExtra) => void;
  clear: () => void;
}

/**
 * State for one inline feedback slot. Every show/error gets a new id, so a repeated
 * message re-announces. The hook never renders UI; `clear()` is the single reset.
 */
export function useFeedback(): UseFeedbackResult {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const lastId = useRef(0);

  const show = useCallback((tone: FeedbackTone, message?: string, extra?: FeedbackExtra) => {
    lastId.current += 1;
    setFeedback({ id: lastId.current, tone, message, ...extra });
  }, []);

  const error = useCallback(
    (message: string, extra?: FeedbackExtra) => {
      show('error', message, extra);
    },
    [show]
  );

  const clear = useCallback(() => {
    setFeedback(null);
  }, []);

  return { feedback, show, error, clear };
}
