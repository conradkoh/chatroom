'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { InlineFeedback } from '@/components/inline-feedback';
import type { Feedback } from '@/components/inline-feedback';
import { useFeedback } from '@/hooks/useFeedback';

export interface SearchParamsErrorState {
  feedback: Feedback | null;
  clear: () => void;
}

/**
 * Reads ?error= once, keeps its decoded text in state, and removes the param without a reload.
 * URLSearchParams.get() already decodes the value, so it is used as is. The text lives in state,
 * so it stays visible after the param is gone. Call this once per page, above any early return.
 */
function useSearchParamsError(): SearchParamsErrorState {
  const searchParams = useSearchParams();
  const { feedback, error, clear } = useFeedback();

  useEffect(() => {
    const message = searchParams.get('error');
    if (!message) return;
    error(message);
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    window.history.replaceState({}, '', url.toString());
  }, [searchParams, error]);

  return { feedback, clear };
}

/** Renders the ?error= alert in place. Mount it at a stable root, never inside a branch. */
export function SearchParamsErrorHandler({ className }: { className?: string }) {
  const { feedback, clear } = useSearchParamsError();

  return (
    <InlineFeedback
      feedback={feedback}
      onDismiss={clear}
      className={className}
      data-testid="url-error"
    />
  );
}
