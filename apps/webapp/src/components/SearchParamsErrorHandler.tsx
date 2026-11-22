'use client';

import { X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';

export interface SearchParamsErrorState {
  /** Decoded ?error= text, or null when nothing is shown. */
  message: string | null;
  clear: () => void;
}

/**
 * Reads ?error= once, keeps its decoded text in state, and removes the param without a reload.
 * URLSearchParams.get() already decodes the value, so it is used as is. The text lives in state,
 * so it stays visible after the param is gone. Call this once per page, above any early return.
 */
export function useSearchParamsError(): SearchParamsErrorState {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const value = searchParams.get('error');
    if (!value) return;
    setMessage(value);
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    window.history.replaceState({}, '', url.toString());
  }, [searchParams]);

  const clear = useCallback(() => setMessage(null), []);

  return { message, clear };
}

/** Page-level failure for ?error=. Renders nothing when there is no message. */
export function SearchParamsErrorAlert({
  message,
  onDismiss,
  className,
}: {
  message: string | null;
  onDismiss: () => void;
  className?: string;
}) {
  if (message === null) return null;

  return (
    <Alert variant="destructive" className={className} data-testid="url-error">
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current"
        >
          <X size={12} aria-hidden />
        </button>
      </AlertAction>
    </Alert>
  );
}

/** Renders the ?error= alert in place. Mount it at a stable root, never inside a branch. */
export function SearchParamsErrorHandler({ className }: { className?: string }) {
  const { message, clear } = useSearchParamsError();
  return <SearchParamsErrorAlert message={message} onDismiss={clear} className={className} />;
}
