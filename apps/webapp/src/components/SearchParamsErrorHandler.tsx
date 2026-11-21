'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { InlineFeedback } from '@/components/inline-feedback';
import { useFeedback } from '@/hooks/useFeedback';

/** Decodes the ?error= value. A malformed % sequence falls back to the raw text. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Reads ?error= from the URL, shows the decoded text as an inline alert, and clears the
 * param without a reload. The text lives in state, so it stays visible after the param is gone.
 */
export function SearchParamsErrorHandler() {
  const searchParams = useSearchParams();
  const { feedback, error, clear } = useFeedback();

  useEffect(() => {
    const raw = searchParams.get('error');
    if (!raw) return;
    error(safeDecode(raw));
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    window.history.replaceState({}, '', url.toString());
  }, [searchParams, error]);

  return <InlineFeedback feedback={feedback} onDismiss={clear} data-testid="url-error" />;
}
