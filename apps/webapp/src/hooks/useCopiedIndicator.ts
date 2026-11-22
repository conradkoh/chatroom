'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const COPIED_INDICATOR_MS = 2000;

/** Holds a `copied` flag that returns to false 2 s after the last `markCopied()`. */
export function useCopiedIndicator(): { copied: boolean; markCopied: () => void } {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markCopied = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCopied(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, COPIED_INDICATOR_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { copied, markCopied };
}
