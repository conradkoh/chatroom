import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_COPY_KEY = 'default';

export interface UseCopyToClipboardResult {
  /** Key whose copy succeeded. Cleared `resetMs` after success. */
  copiedKey: string | null;
  /** Key whose last copy failed. Kept until the next copy() call. */
  failedKey: string | null;
  /** Writes text to the clipboard. Resolves true on success, false on failure. */
  copy: (text: string, key?: string) => Promise<boolean>;
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null };

/** Cancels a pending reset timer, if any. */
function clearTimer(timerRef: TimerRef): void {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

/**
 * Shared copy feedback. A success marks `copiedKey` for `resetMs` (drives an icon swap).
 * A failure marks `failedKey` until the next copy attempt; the caller renders it inline.
 */
export function useCopyToClipboard(resetMs = 2000): UseCopyToClipboardResult {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimer(resetTimerRef);
    };
  }, []);

  const markFailed = useCallback((key: string) => {
    if (!isMountedRef.current) return;
    setCopiedKey(null);
    setFailedKey(key);
  }, []);

  const markCopied = useCallback(
    (key: string) => {
      if (!isMountedRef.current) return;
      setCopiedKey(key);
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        setCopiedKey(null);
      }, resetMs);
    },
    [resetMs]
  );

  const copy = useCallback(
    async (text: string, key: string = DEFAULT_COPY_KEY): Promise<boolean> => {
      clearTimer(resetTimerRef);
      setFailedKey(null);
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        console.error('Failed to copy text: ', error);
        markFailed(key);
        return false;
      }
      markCopied(key);
      return true;
    },
    [markFailed, markCopied]
  );

  return { copiedKey, failedKey, copy };
}
